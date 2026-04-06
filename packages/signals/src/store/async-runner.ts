import type {
    AsyncRunCompletion,
    AsyncRunnerAbortHelpers,
    AsyncRunnerCommitInfo,
    AsyncRunnerContext,
    AsyncRunnerControl,
    AsyncRunnerHooks,
    EffectInstance,
    EffectRun,
    StoreState,
} from './internal';
import {
    ABORT_CONTROL,
    ABORT_RERUN,
    ABORT_STOP,
    CANCELED,
    FULFILLED,
    PENDING_ASYNC,
    REJECTED,
    RUNNING_SYNC,
    SETTLED,
} from './internal';
import { DefaultInvalidationQueue } from './queue';
import type { AsyncEffectErrorInfo, AsyncInvalidation, Immutable, SignalReader } from './types';

const CONCURRENCY_CANCEL = 0;
const CONCURRENCY_CONCURRENT = 1;
const CONCURRENCY_QUEUE = 2;

const ERROR_MODE_REPORT = 0;
const ERROR_MODE_CANCEL = 1;
const ERROR_MODE_THROW = 2;

interface AsyncRunnerOptions {
    readonly _signal?: AbortSignal | undefined;
    readonly _queue?:
        | {
              enqueue(item: AsyncInvalidation): void;
              dequeue(): AsyncInvalidation | undefined;
              clear(): void;
          }
        | undefined;
    readonly _concurrency?: 'cancel' | 'concurrent' | 'queue';
    readonly _onError?:
        | {
              readonly mode?: 'report' | 'cancel' | 'throw';
              readonly handler?: ((error: unknown, info: AsyncEffectErrorInfo) => void) | undefined;
          }
        | undefined;
    readonly _trackDependencies?: boolean | undefined;
}

export function createAsyncRunner<Prepared, Result, Trigger = void>(
    state: StoreState,
    effect: EffectInstance,
    {
        _signal: signal,
        _queue: queue,
        _concurrency: concurrency = 'cancel',
        _onError: onError,
        _trackDependencies: trackDependencies = true,
    }: AsyncRunnerOptions,
    hooks: AsyncRunnerHooks<Prepared, Result, Trigger>,
): AsyncRunnerControl<Trigger> {
    if (queue && concurrency !== 'queue') {
        throw new Error('queue needs queue concurrency.');
    }

    const concurrencyMode =
        concurrency === 'concurrent'
            ? CONCURRENCY_CONCURRENT
            : concurrency === 'queue'
              ? CONCURRENCY_QUEUE
              : CONCURRENCY_CANCEL;
    const errorMode =
        onError?.mode === 'cancel'
            ? ERROR_MODE_CANCEL
            : onError?.mode === 'throw'
              ? ERROR_MODE_THROW
              : ERROR_MODE_REPORT;

    const activeRuns = new Set<EffectRun>();
    const preparedRuns = new Map<EffectRun, Prepared>();
    const retainedDependencyUnlinks = new Set<() => void>();
    const pendingQueue =
        concurrencyMode === CONCURRENCY_QUEUE
            ? (queue ?? new DefaultInvalidationQueue<AsyncInvalidation>())
            : undefined;
    const errorHandler = onError?.handler ?? hooks._defaultErrorHandler ?? (() => {});

    let generation = 0;
    let invalidationGeneration = 0;
    let latestStartedGeneration = 0;
    let currentCommittedRun: EffectRun | undefined;
    let pendingRerun = false;
    let stopped = false;
    let nextTrigger: Trigger | undefined;
    const queuedTriggers: Array<Trigger | typeof NO_TRIGGER> = [];

    const cleanupCallback = (cleanup: () => void): void => {
        try {
            cleanup();
        } catch (error) {
            console.error('Cleanup:', error);
        }
    };

    const clearRetainedDependencies = (): void => {
        for (const unlink of retainedDependencyUnlinks) {
            unlink();
        }
        retainedDependencyUnlinks.clear();
    };

    const dropTrigger = (trigger: Trigger | undefined): void => {
        if (trigger !== undefined) {
            hooks._dropTrigger?.(trigger);
        }
    };

    const clearPendingTriggers = (): void => {
        dropTrigger(nextTrigger);
        nextTrigger = undefined;

        for (const trigger of queuedTriggers) {
            if (trigger !== NO_TRIGGER) {
                hooks._dropTrigger?.(trigger);
            }
        }
        queuedTriggers.length = 0;
    };

    const cleanupRun = (run: EffectRun): void => {
        if (!run._areDependenciesComplete) {
            for (const unlink of run._dependencyUnlinks) {
                unlink();
            }
            run._dependencyUnlinks.clear();
            run._areDependenciesComplete = true;
        }

        if (!run._isCleanupComplete) {
            for (const cleanup of run._cleanups) {
                cleanupCallback(cleanup);
            }
            run._cleanups.clear();
            run._isCleanupComplete = true;
        }

        preparedRuns.delete(run);

        if (currentCommittedRun === run) {
            currentCommittedRun = undefined;
        }
    };

    const preserveRunDependencies = (run: EffectRun): void => {
        for (const unlink of run._dependencyUnlinks) {
            retainedDependencyUnlinks.add(unlink);
        }
        run._dependencyUnlinks.clear();
        run._areDependenciesComplete = true;
    };

    const abortHelpers: AsyncRunnerAbortHelpers = {
        _cleanupRun: cleanupRun,
        _preserveRunDependencies: preserveRunDependencies,
    };

    const clearCommittedRun = (): void => {
        if (!currentCommittedRun) {
            return;
        }
        cleanupRun(currentCommittedRun);
        currentCommittedRun = undefined;
    };

    const finishRun = (run: EffectRun): void => {
        activeRuns.delete(run);
        run._isActive = false;
    };

    const hasBlockingRun = (): boolean => {
        for (const run of activeRuns) {
            if (run._state === PENDING_ASYNC || run._state === CANCELED) {
                return true;
            }
        }

        return false;
    };

    const handleAsyncError = (error: unknown, run: EffectRun): void => {
        const info: AsyncEffectErrorInfo = {
            generation: run._generation,
            concurrency,
            signal: run._signal,
            canceled: run._signal.aborted,
        };

        errorHandler(error, info);

        if (errorMode === ERROR_MODE_CANCEL) {
            if (hooks._onErrorCancel) {
                hooks._onErrorCancel(control);
            } else {
                control._stop();
            }
        } else if (errorMode === ERROR_MODE_THROW) {
            queueMicrotask(() => {
                throw error;
            });
        }
    };

    const createRun = (): EffectRun => {
        const controller = new AbortController();
        return {
            _effect: effect,
            _generation: ++generation,
            _cleanups: new Set(),
            _dependencyUnlinks: new Set(),
            _controller: controller,
            _signal: controller.signal,
            _state: RUNNING_SYNC,
            _isCleanupComplete: false,
            _areDependenciesComplete: false,
            _isActive: true,
            _isTracking: trackDependencies,
            _onDependencyCleanup(unlink) {
                this._dependencyUnlinks.add(unlink);
            },
        };
    };

    const registerCleanup = (run: EffectRun, cleanup: () => void): void => {
        if (run._isCleanupComplete) {
            cleanupCallback(cleanup);
            return;
        }

        run._cleanups.add(cleanup);
    };

    const track = <T>(run: EffectRun, read: SignalReader<T>): Immutable<T> => {
        if (
            !run._isActive
            || run._state === CANCELED
            || run._areDependenciesComplete
            || run._isCleanupComplete
        ) {
            return read();
        }

        const wasTracking = state._isTracking;
        const previousTracking = run._isTracking;

        state._runs.push(run);
        state._isTracking = true;
        run._isTracking = true;

        try {
            return read();
        } finally {
            run._isTracking = previousTracking;
            state._isTracking = wasTracking;
            state._runs.pop();
        }
    };

    const startNextQueuedRun = (): void => {
        if (stopped || concurrencyMode !== CONCURRENCY_QUEUE || !pendingQueue || hasBlockingRun()) {
            return;
        }

        while (true) {
            const nextInvalidation = pendingQueue.dequeue();
            if (!nextInvalidation) {
                return;
            }

            void nextInvalidation;
            const queuedTrigger = queuedTriggers.shift();
            const nextTrigger = queuedTrigger === NO_TRIGGER ? undefined : queuedTrigger;

            if (startRun(nextTrigger)) {
                return;
            }
        }
    };

    const commitInfo = (): AsyncRunnerCommitInfo => ({
        _latestStartedGeneration: latestStartedGeneration,
    });

    const finalizeCompletion = (run: EffectRun, completion: AsyncRunCompletion<Result>): void => {
        finishRun(run);

        if (run._state === CANCELED) {
            if (pendingRerun) {
                pendingRerun = false;
                startRun();
            } else {
                cleanupRun(run);
                startNextQueuedRun();
            }
            return;
        }

        const prepared = preparedRuns.get(run) as Prepared;
        run._state = SETTLED;

        if (completion._status === REJECTED) {
            handleAsyncError(completion._error, run);
        }

        hooks._onCompletion?.(run, completion, prepared);

        if (stopped) {
            cleanupRun(run);
            startNextQueuedRun();
            return;
        }

        const shouldCommit = hooks._shouldCommit?.(run, completion, prepared, commitInfo()) ?? true;

        if (shouldCommit) {
            hooks._commit(run, completion, prepared);
            currentCommittedRun = run;
        } else {
            cleanupRun(run);
        }

        startNextQueuedRun();
    };

    const abortRun = (
        run: EffectRun,
        kind: typeof ABORT_RERUN | typeof ABORT_CONTROL | typeof ABORT_STOP,
    ): void => {
        if (preparedRuns.has(run)) {
            const prepared = preparedRuns.get(run) as Prepared;

            if (hooks._abortRun?.(run, prepared, kind, abortHelpers)) {
                return;
            }
        }

        run._isTracking = false;

        if (!run._signal.aborted) {
            run._controller.abort();
        }

        run._state = CANCELED;
        cleanupRun(run);
    };

    const consumeTrigger = (): Trigger | undefined => {
        const trigger = nextTrigger;
        nextTrigger = undefined;
        return trigger;
    };

    const mergeTrigger = (trigger: Trigger | undefined): void => {
        nextTrigger = hooks._mergeTrigger?.(nextTrigger, trigger) ?? trigger ?? nextTrigger;
    };

    const startRun = (trigger = consumeTrigger()): boolean => {
        clearCommittedRun();
        clearRetainedDependencies();

        if (stopped) {
            return false;
        }

        if (trigger !== undefined && hooks._skipTrigger?.(trigger)) {
            dropTrigger(trigger);
            return false;
        }

        const prepared = hooks._prepare(trigger);
        const run = createRun();

        latestStartedGeneration = run._generation;
        activeRuns.add(run);
        preparedRuns.set(run, prepared);
        const wasTracking = state._isTracking;

        if (trackDependencies) {
            state._runs.push(run);
            state._isTracking = true;
        } else {
            state._isTracking = false;
            run._isTracking = false;
        }

        let result: Result | PromiseLike<Result>;

        try {
            result = hooks._execute(
                {
                    _signal: run._signal,
                    _onCleanup(cleanup) {
                        registerCleanup(run, cleanup);
                    },
                    _track<T>(read: SignalReader<T>): Immutable<T> {
                        return track(run, read);
                    },
                    _abort() {
                        abortRun(run, ABORT_CONTROL);
                    },
                } satisfies AsyncRunnerContext,
                prepared,
            );
        } catch (error) {
            run._isTracking = false;
            state._isTracking = wasTracking;
            if (trackDependencies) {
                state._runs.pop();
            }
            finishRun(run);
            cleanupRun(run);
            control._stop();
            throw error;
        }

        run._isTracking = false;
        state._isTracking = wasTracking;
        if (trackDependencies) {
            state._runs.pop();
        }

        if (run._state === CANCELED) {
            finishRun(run);
            cleanupRun(run);
            startNextQueuedRun();
            return false;
        }

        const currentPrepared = preparedRuns.get(run) as Prepared;
        if (!isPromiseLike(result)) {
            hooks._handleSyncResult?.(run, result, currentPrepared);

            run._state = SETTLED;
            currentCommittedRun = run;
            return true;
        }

        run._state = PENDING_ASYNC;

        void Promise.resolve(result).then(
            (value) => {
                finalizeCompletion(run, { _status: FULFILLED, _value: value });
            },
            (error: unknown) => {
                finalizeCompletion(run, { _status: REJECTED, _error: error });
            },
        );
        return true;
    };

    const invalidate = (trigger: Trigger | undefined, fromDependency: boolean): void => {
        if (stopped) {
            return;
        }

        if (
            fromDependency
            && state._runs.some((run) => run._effect === effect && run._isTracking)
        ) {
            throw new Error('Cycle detected.');
        }

        if (concurrencyMode === CONCURRENCY_CANCEL) {
            mergeTrigger(trigger);

            if (hasBlockingRun()) {
                pendingRerun = true;
                for (const run of activeRuns) {
                    abortRun(run, ABORT_RERUN);
                }
                return;
            }

            startRun();
            return;
        }

        if (concurrencyMode === CONCURRENCY_CONCURRENT) {
            startRun(trigger);
            return;
        }

        if (hasBlockingRun()) {
            pendingQueue?.enqueue({ generation: ++invalidationGeneration });
            queuedTriggers.push(trigger === undefined ? NO_TRIGGER : trigger);
            return;
        }

        startRun(trigger);
    };

    const control: AsyncRunnerControl<Trigger> = {
        _invalidate(trigger?: Trigger): void {
            invalidate(trigger, false);
        },
        _invalidateFromDependency(trigger?: Trigger): void {
            invalidate(trigger, true);
        },
        _cancelActive(): void {
            if (stopped) {
                return;
            }

            pendingRerun = false;
            pendingQueue?.clear();
            clearPendingTriggers();

            for (const run of activeRuns) {
                abortRun(run, ABORT_CONTROL);
            }
        },
        _stop(): void {
            if (stopped) {
                return;
            }

            stopped = true;
            pendingRerun = false;
            pendingQueue?.clear();
            clearPendingTriggers();
            state._pendingEffects.delete(effect);
            state._activeEffects.delete(effect);
            clearCommittedRun();
            clearRetainedDependencies();
            hooks._onStop?.();

            for (const run of activeRuns) {
                abortRun(run, ABORT_STOP);
            }
        },
    };

    state._activeEffects.add(effect);

    if (signal?.aborted) {
        control._stop();
    } else if (signal) {
        signal.addEventListener('abort', control._stop, { once: true });
    }

    return control;
}

const NO_TRIGGER = Symbol();

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
    return (
        value !== null
        && (typeof value === 'object' || typeof value === 'function')
        && 'then' in value
        && typeof value.then === 'function'
    );
}
