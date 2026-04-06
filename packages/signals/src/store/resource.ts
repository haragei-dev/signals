import { createAsyncRunner } from './async-runner';
import { ABORT_CONTROL, CANCELED, FULFILLED, REJECTED } from './internal';
import type { EffectInstance, StoreState } from './internal';
import { createSignal } from './signal';
import type {
    Immutable,
    ResourceContext,
    ResourceControls,
    ResourceOptions,
    ResourceState,
    RunCause,
    SignalReader,
} from './types';

type ResourceCompletion<T> =
    | { _status: typeof FULFILLED; _value: Immutable<T> }
    | { _status: typeof REJECTED; _error: unknown };

interface ResourcePrepared<T, E = unknown> {
    readonly _previous: Immutable<ResourceState<T, E>>;
    readonly _cause: RunCause;
}

function createIdleState<T, E = unknown>(): Immutable<ResourceState<T, E>> {
    return {
        status: 'idle',
        value: undefined,
        error: undefined,
        isStale: false,
    };
}

function getLoadingState<T, E = unknown>(
    previous: Immutable<ResourceState<T, E>>,
): Immutable<ResourceState<T, E>> {
    if (previous.value !== undefined) {
        return {
            status: 'loading',
            value: previous.value as Immutable<T>,
            error: undefined,
            isStale: true,
        };
    }

    return {
        status: 'loading',
        value: undefined,
        error: undefined,
        isStale: false,
    };
}

export function createResource<T, E = unknown>(
    state: StoreState,
    load: (context: ResourceContext<T, E>) => Promise<Immutable<T>>,
    { signal, queue, concurrency = 'cancel', onError, writes = 'latest' }: ResourceOptions = {},
): readonly [SignalReader<ResourceState<T, E>>, ResourceControls] {
    const [read, write] = createSignal<ResourceState<T, E>>(state, createIdleState<T, E>());
    let currentState = read();
    let stopped = false;

    const setState = (nextState: Immutable<ResourceState<T, E>>): void => {
        currentState = nextState;
        write(nextState);
    };

    const fx: EffectInstance = {
        _isMemo: false,
        _update(): void {
            control._invalidateFromDependency();
        },
        _cancel(): void {
            control._stop();
        },
    };

    const control = createAsyncRunner<ResourcePrepared<T, E>, Immutable<T>, RunCause>(
        state,
        fx,
        {
            _signal: signal,
            _queue: queue,
            _concurrency: concurrency,
            _onError: onError,
        },
        {
            _prepare(trigger): ResourcePrepared<T, E> {
                const prepared: ResourcePrepared<T, E> = {
                    _previous: currentState,
                    _cause: trigger ?? 'dependency',
                };

                setState(getLoadingState(prepared._previous));
                return prepared;
            },
            _execute(context, prepared): Promise<Immutable<T>> {
                try {
                    return load({
                        cancel: fx._cancel,
                        refresh: controls.refresh,
                        abort: controls.abort,
                        reset: controls.reset,
                        track: context._track as <U>(reader: SignalReader<U>) => Immutable<U>,
                        signal: context._signal,
                        onCleanup: context._onCleanup,
                        previous: prepared._previous,
                        cause: prepared._cause,
                    });
                } catch (error) {
                    return Promise.reject(error);
                }
            },
            _commit(_run, completion, prepared): void {
                const result = completion as ResourceCompletion<T>;

                if (result._status === FULFILLED) {
                    setState({
                        status: 'ready',
                        value: result._value,
                        error: undefined,
                        isStale: false,
                    });
                    return;
                }

                setState({
                    status: 'error',
                    value: prepared._previous.value,
                    error: result._error as Immutable<E>,
                    isStale: prepared._previous.value !== undefined,
                });
            },
            _shouldCommit(run, _completion, _prepared, info): boolean {
                return writes === 'settled' || run._generation === info._latestStartedGeneration;
            },
            _mergeTrigger(current, next): RunCause | undefined {
                return next ?? current;
            },
            _onErrorCancel(shared): void {
                shared._cancelActive();
            },
            _onStop(): void {
                stopped = true;
            },
            _abortRun(run, _prepared, kind, helpers): boolean {
                if (kind !== ABORT_CONTROL) {
                    return false;
                }

                run._isTracking = false;
                run._controller.abort();
                run._state = CANCELED;
                helpers._preserveRunDependencies(run);
                helpers._cleanupRun(run);
                return true;
            },
        },
    );

    const controls: ResourceControls = {
        refresh(): void {
            if (stopped) {
                return;
            }
            control._invalidate('refresh');
        },
        abort(): void {
            if (stopped) {
                return;
            }
            control._cancelActive();
        },
        reset(): void {
            if (stopped) {
                return;
            }
            control._cancelActive();
            setState(createIdleState<T, E>());
        },
    };

    control._invalidate('init');

    return [read, controls] as const;
}
