import { createAsyncRunner } from './async-runner';
import { CANCELED, FULFILLED } from './internal';
import type { EffectInstance, StoreState } from './internal';
import { createSignal } from './signal';
import type {
    ActionContext,
    ActionControls,
    ActionOptions,
    ActionState,
    ActionSubmitOptions,
    Immutable,
    SignalReader,
} from './types';

interface ActionTrigger<Args extends readonly unknown[], T> {
    readonly _args: Args;
    readonly _resolve: (value: Immutable<T>) => void;
    readonly _reject: (reason?: unknown) => void;
    _isSettled: boolean;
    _abortActiveRun?: (() => void) | undefined;
    _removeSignalAbort?: (() => void) | undefined;
}

interface ActionPrepared<Args extends readonly unknown[], T, E = unknown> {
    readonly _previous: Immutable<ActionState<T, E>>;
    readonly _trigger: ActionTrigger<Args, T>;
}

function createIdleState<T, E = unknown>(): Immutable<ActionState<T, E>> {
    return {
        status: 'idle',
        value: undefined,
        error: undefined,
        isStale: false,
    };
}

function getPendingState<T, E = unknown>(
    previous: Immutable<ActionState<T, E>>,
): Immutable<ActionState<T, E>> {
    if (previous.value !== undefined) {
        return {
            status: 'pending',
            value: previous.value as Immutable<T>,
            error: undefined,
            isStale: true,
        };
    }

    return {
        status: 'pending',
        value: undefined,
        error: undefined,
        isStale: false,
    };
}

function createAbortError(): Error {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

function cleanupTrigger<Args extends readonly unknown[], T>(trigger: ActionTrigger<Args, T>): void {
    trigger._abortActiveRun = undefined;
    trigger._removeSignalAbort?.();
    trigger._removeSignalAbort = undefined;
}

function settleTrigger<Args extends readonly unknown[], T>(
    trigger: ActionTrigger<Args, T>,
    settle: (trigger: ActionTrigger<Args, T>) => void,
): void {
    if (trigger._isSettled) {
        return;
    }

    trigger._isSettled = true;
    cleanupTrigger(trigger);
    settle(trigger);
}

export function createAction<Args extends readonly unknown[], T, E = unknown>(
    state: StoreState,
    execute: (context: ActionContext<T, E>, ...args: Args) => Promise<Immutable<T>>,
    { signal, queue, concurrency = 'cancel', onError }: ActionOptions = {},
): readonly [SignalReader<ActionState<T, E>>, ActionControls<Args, T>] {
    if (signal?.aborted) {
        const [read] = createSignal<ActionState<T, E>>(state, createIdleState<T, E>());
        const reject = (): Promise<Immutable<T>> => Promise.reject(createAbortError());
        const controls: ActionControls<Args, T> = {
            submit(): Promise<Immutable<T>> {
                return reject();
            },
            submitWith(): Promise<Immutable<T>> {
                return reject();
            },
            abort(): void {},
            reset(): void {},
        };

        return [read, controls] as const;
    }

    const [read, write] = createSignal<ActionState<T, E>>(state, createIdleState<T, E>());
    let currentState = read();
    let settledState = currentState;
    let latestStartedTrigger: ActionTrigger<Args, T> | undefined;
    let restoreStateOnDropTrigger: ActionTrigger<Args, T> | undefined;
    let stopped = false;

    const setState = (nextState: Immutable<ActionState<T, E>>): void => {
        currentState = nextState;
        write(nextState);
    };

    const commitSettledState = (nextState: Immutable<ActionState<T, E>>): void => {
        settledState = nextState;
        setState(nextState);
    };

    const fx: EffectInstance = {
        _isMemo: false,
        _update(): void {},
        _cancel(): void {
            control._stop();
        },
    };

    const control = createAsyncRunner<
        ActionPrepared<Args, T, E>,
        Immutable<T>,
        ActionTrigger<Args, T>
    >(
        state,
        fx,
        {
            _signal: signal,
            _queue: queue,
            _concurrency: concurrency,
            _onError: onError,
            _trackDependencies: false,
        },
        {
            _skipTrigger(trigger): boolean {
                return trigger._isSettled;
            },
            _prepare(trigger): ActionPrepared<Args, T, E> {
                const prepared: ActionPrepared<Args, T, E> = {
                    _previous: currentState,
                    _trigger: trigger as ActionTrigger<Args, T>,
                };

                if (prepared._trigger === restoreStateOnDropTrigger) {
                    restoreStateOnDropTrigger = undefined;
                }

                setState(getPendingState(prepared._previous));
                return prepared;
            },
            _execute(context, prepared): Promise<Immutable<T>> {
                const { _trigger: trigger } = prepared;
                latestStartedTrigger = trigger;

                trigger._abortActiveRun = () => {
                    context._abort();

                    if (trigger === latestStartedTrigger) {
                        setState(settledState);
                    }
                };

                try {
                    return Promise.resolve(
                        execute(
                            {
                                signal: context._signal,
                                onCleanup(cleanup) {
                                    context._onCleanup(cleanup);
                                },
                                previous: prepared._previous,
                            } satisfies ActionContext<T, E>,
                            ...trigger._args,
                        ),
                    );
                } catch (error) {
                    return Promise.reject(error);
                }
            },
            _onCompletion(_run, completion, prepared): void {
                if (completion._status === FULFILLED) {
                    settleTrigger(prepared._trigger, (trigger) => {
                        trigger._resolve(completion._value);
                    });
                    return;
                }

                settleTrigger(prepared._trigger, (trigger) => {
                    trigger._reject(completion._error);
                });
            },
            _commit(_run, completion, prepared): void {
                if (completion._status === FULFILLED) {
                    commitSettledState({
                        status: 'success',
                        value: completion._value,
                        error: undefined,
                        isStale: false,
                    });
                    return;
                }

                commitSettledState({
                    status: 'error',
                    value: prepared._previous.value,
                    error: completion._error as Immutable<E>,
                    isStale: prepared._previous.value !== undefined,
                });
            },
            _shouldCommit(_run, _completion, prepared): boolean {
                return prepared._trigger === latestStartedTrigger;
            },
            _mergeTrigger(current, next): ActionTrigger<Args, T> | undefined {
                if (current && current !== next) {
                    settleTrigger(current, (trigger) => {
                        trigger._reject(createAbortError());
                    });
                }

                const trigger = next as ActionTrigger<Args, T>;
                restoreStateOnDropTrigger = trigger;
                return trigger;
            },
            _dropTrigger(trigger): void {
                if (trigger === restoreStateOnDropTrigger) {
                    restoreStateOnDropTrigger = undefined;
                    setState(settledState);
                }

                settleTrigger(trigger, (currentTrigger) => {
                    currentTrigger._reject(createAbortError());
                });
            },
            _onErrorCancel(shared): void {
                shared._cancelActive();
            },
            _onStop(): void {
                stopped = true;
                setState(settledState);
            },
            _abortRun(run, prepared, _kind, helpers): boolean {
                run._isTracking = false;
                run._controller.abort();
                run._state = CANCELED;
                settleTrigger(prepared._trigger, (trigger) => {
                    trigger._reject(createAbortError());
                });
                helpers._cleanupRun(run);
                return true;
            },
        },
    );

    const createTrigger = (
        args: Args,
        resolve: (value: Immutable<T>) => void,
        reject: (reason?: unknown) => void,
        submitOptions?: ActionSubmitOptions,
    ): ActionTrigger<Args, T> => {
        const signal = submitOptions?.signal;
        const trigger: ActionTrigger<Args, T> = {
            _args: args,
            _resolve: resolve,
            _reject: reject,
            _isSettled: false,
        };

        if (signal) {
            const abortFromSignal = (): void => {
                if (trigger._abortActiveRun) {
                    trigger._abortActiveRun();
                    return;
                }

                settleTrigger(trigger, (currentTrigger) => {
                    currentTrigger._reject(createAbortError());
                });
            };

            signal.addEventListener('abort', abortFromSignal, { once: true });
            trigger._removeSignalAbort = () => {
                signal.removeEventListener('abort', abortFromSignal);
            };
        }

        return trigger;
    };

    const submit = (args: Args, submitOptions?: ActionSubmitOptions): Promise<Immutable<T>> => {
        if (stopped) {
            return Promise.reject(createAbortError());
        }

        if (submitOptions?.signal?.aborted) {
            return Promise.reject(createAbortError());
        }

        return new Promise<Immutable<T>>((resolve, reject) => {
            const trigger = createTrigger(args, resolve, reject, submitOptions);
            control._invalidate(trigger);
        });
    };

    const controls: ActionControls<Args, T> = {
        submit(...args: Args): Promise<Immutable<T>> {
            return submit(args);
        },
        submitWith(options: ActionSubmitOptions, ...args: Args): Promise<Immutable<T>> {
            return submit(args, options);
        },
        abort(): void {
            if (stopped) {
                return;
            }

            control._cancelActive();
            setState(settledState);
        },
        reset(): void {
            if (stopped) {
                return;
            }

            control._cancelActive();
            commitSettledState(createIdleState<T, E>());
        },
    };

    return [read, controls] as const;
}
