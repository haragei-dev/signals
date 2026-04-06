import type { LifecycleOwner, StoreState } from '../store/internal';

export function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;

    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

export async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

export function createTestState(): StoreState {
    return {
        _batchLevel: 0,
        _isUpdating: false,
        _isTracking: false,
        _pendingEffects: new Set(),
        _runs: [],
        _activeEffects: new Set(),
    };
}

export function createTestOwner(state = createTestState()): LifecycleOwner {
    return {
        _state: state,
        _children: new Set(),
        _ownedEffects: new Set(),
        _ownedSignals: new Set(),
        _active: true,
    };
}
