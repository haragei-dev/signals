import type {
    AsyncEffectConcurrency,
    AsyncEffectErrorOptions,
    InvalidationQueue,
    SignalReader,
} from './types';

export const RUNNING_SYNC = 0;
export const PENDING_ASYNC = 1;
export const SETTLED = 2;
export const CANCELED = 3;

export type EffectRunState =
    | typeof RUNNING_SYNC
    | typeof PENDING_ASYNC
    | typeof SETTLED
    | typeof CANCELED;

export const FULFILLED = 0;
export const REJECTED = 1;

export type AsyncRunStatus = typeof FULFILLED | typeof REJECTED;

export const ABORT_RERUN = 0;
export const ABORT_CONTROL = 1;
export const ABORT_STOP = 2;

export type AsyncRunnerAbortKind = typeof ABORT_RERUN | typeof ABORT_CONTROL | typeof ABORT_STOP;

export interface EffectInstance {
    readonly _isMemo: boolean;
    readonly _update: () => void;
    readonly _cancel: () => void;
}

export interface TrackingRun {
    readonly _effect: EffectInstance;
    _isTracking: boolean;
    _onDependencyCleanup(unlink: () => void): void;
}

export interface EffectRun extends TrackingRun {
    readonly _generation: number;
    readonly _cleanups: Set<() => void>;
    readonly _dependencyUnlinks: Set<() => void>;
    readonly _controller: AbortController;
    readonly _signal: AbortSignal;
    _state: EffectRunState;
    _isCleanupComplete: boolean;
    _areDependenciesComplete: boolean;
    _isActive: boolean;
}

export interface InternalEffectOptions {
    readonly _isMemo?: boolean;
    readonly _signal?: AbortSignal;
    readonly _queue?: InvalidationQueue;
    readonly _concurrency?: AsyncEffectConcurrency;
    readonly _onError?: AsyncEffectErrorOptions;
}

export interface StoreState {
    _batchLevel: number;
    _isUpdating: boolean;
    _isTracking: boolean;
    readonly _runs: TrackingRun[];
    readonly _pendingEffects: Set<EffectInstance>;
    readonly _activeEffects: Set<EffectInstance>;
}

export interface AsyncRunnerContext {
    readonly _signal: AbortSignal;
    _onCleanup(cleanup: () => void): void;
    _track<T>(read: SignalReader<T>): T;
}

export type AsyncRunCompletion<Result> =
    | { _status: typeof FULFILLED; _value: Result }
    | { _status: typeof REJECTED; _error: unknown };

export interface AsyncRunnerCommitInfo {
    readonly _latestStartedGeneration: number;
}

export interface AsyncRunnerControl<Trigger = void> {
    _invalidate(trigger?: Trigger): void;
    _invalidateFromDependency(trigger?: Trigger): void;
    _cancelActive(): void;
    _stop(): void;
}

export interface AsyncRunnerAbortHelpers {
    _cleanupRun(run: EffectRun): void;
    _preserveRunDependencies(run: EffectRun): void;
}

export interface AsyncRunnerHooks<Prepared, Result, Trigger = void> {
    _prepare(trigger: Trigger | undefined): Prepared;
    _execute(context: AsyncRunnerContext, prepared: Prepared): Result | PromiseLike<Result>;
    _handleSyncResult?(run: EffectRun, result: Result, prepared: Prepared): boolean;
    _commit(run: EffectRun, completion: AsyncRunCompletion<Result>, prepared: Prepared): void;
    _shouldCommit?(
        run: EffectRun,
        completion: AsyncRunCompletion<Result>,
        prepared: Prepared,
        info: AsyncRunnerCommitInfo,
    ): boolean;
    _mergeTrigger?(current: Trigger | undefined, next: Trigger | undefined): Trigger | undefined;
    _defaultErrorHandler?(error: unknown): void;
    _onErrorCancel?(control: AsyncRunnerControl<Trigger>): void;
    _abortRun?(
        run: EffectRun,
        prepared: Prepared,
        kind: AsyncRunnerAbortKind,
        helpers: AsyncRunnerAbortHelpers,
    ): boolean;
    _onStop?(): void;
}
