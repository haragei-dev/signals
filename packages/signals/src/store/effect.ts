import { createAsyncRunner } from './async-runner';
import type { EffectInstance, InternalEffectOptions, StoreState } from './internal';
import type {
    AsyncEffectContext,
    AsyncEffectFunction,
    EffectContext,
    EffectFunction,
    Immutable,
    SignalReader,
} from './types';

export function createEffect(
    state: StoreState,
    execute: EffectFunction | AsyncEffectFunction,
    {
        _isMemo: isMemo = false,
        _signal: signal,
        _queue: queue,
        _concurrency: concurrency = 'cancel',
        _onError: onError,
    }: InternalEffectOptions = {},
): () => void {
    if (signal?.aborted) {
        return () => {};
    }

    let canceled = false;

    const cancel = (): void => {
        if (canceled) {
            return;
        }

        canceled = true;
        control._stop();
    };

    const update = (): void => {
        if (canceled) {
            return;
        }
        control._invalidateFromDependency();
    };

    const fx: EffectInstance = {
        _isMemo: isMemo,
        _update: update,
        _cancel: cancel,
    };

    const control = createAsyncRunner<void, void | (() => void)>(
        state,
        fx,
        {
            _signal: signal,
            _queue: queue,
            _concurrency: concurrency,
            _onError: onError,
        },
        {
            _prepare(): void {},
            _execute(context): void | (() => void) | Promise<void> {
                return execute({
                    cancel,
                    track: context._track as <T>(read: SignalReader<T>) => Immutable<T>,
                    signal: context._signal,
                    onCleanup: context._onCleanup,
                } as EffectContext & AsyncEffectContext);
            },
            _handleSyncResult(run, result): boolean {
                if (typeof result === 'function') {
                    run._cleanups.add(result);
                }

                return true;
            },
            _commit(): void {},
            _shouldCommit(run, _completion, _prepared, info): boolean {
                return run._generation === info._latestStartedGeneration;
            },
            _defaultErrorHandler(error): void {
                console.error('Error in async effect:', error);
            },
            _onErrorCancel(): void {
                cancel();
            },
        },
    );

    update();

    return cancel;
}
