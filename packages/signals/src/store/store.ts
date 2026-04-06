import { createAction } from './action';
import { createEffect } from './effect';
import { flushPendingEffects } from './flush';
import type { InternalEffectOptions, LifecycleOwner, StoreState } from './internal';
import { createResource } from './resource';
import { createSignal, readUntracked } from './signal';
import type {
    ActionConstructor,
    ActionContext,
    ActionOptions,
    AsyncEffectFunction,
    AsyncEffectOptions,
    EffectConstructor,
    EffectFunction,
    EffectOptions,
    Immutable,
    MemoConstructor,
    ResourceConstructor,
    ResourceContext,
    ResourceOptions,
    SignalOptions,
    SignalReader,
    Store,
    UntrackedReader,
} from './types';

/**
 * Creates a new store.
 *
 * A store is a collection of related signals and effects.
 *
 * Signals, memos, effects and batch processes from different stores MUST NOT be mixed.
 *
 * @returns A new store.
 */
export function createStore(): Store {
    const state: StoreState = {
        _batchLevel: 0,
        _isUpdating: false,
        _isTracking: true,
        _pendingEffects: new Set(),
        _runs: [],
        _activeEffects: new Set(),
    };
    return createScopedStore(state, createLifecycleOwner(state));
}

function createScopedStore(state: StoreState, owner: LifecycleOwner): Store {
    const signal = <T>(initialValue: T | Immutable<T>, options?: SignalOptions) => {
        return createSignal(state, owner, initialValue, options);
    };

    const untracked: UntrackedReader = <T>(read: () => Immutable<T>): Immutable<T> => {
        return readUntracked(state, read);
    };

    const effect: EffectConstructor = (
        execute: EffectFunction | AsyncEffectFunction,
        options?: EffectOptions | AsyncEffectOptions,
    ): (() => void) => {
        const asyncOptions = options as AsyncEffectOptions | undefined;

        return createEffect(state, owner, execute, {
            _isMemo: false,
            _signal: options?.signal,
            _queue: asyncOptions?.queue,
            _concurrency: asyncOptions?.concurrency,
            _onError: asyncOptions?.onError,
        } as InternalEffectOptions);
    };

    const memo: MemoConstructor = <T>(
        compute: () => T,
        options?: SignalOptions & EffectOptions,
    ): SignalReader<T> => {
        const [read, write] = createSignal<T>(state, owner, undefined as T, options);

        createEffect(state, owner, () => write(compute()), {
            _isMemo: true,
            _signal: options?.signal,
        } as InternalEffectOptions);

        return read;
    };

    const action: ActionConstructor = <T, Args extends readonly unknown[] = [], E = unknown>(
        execute: (context: ActionContext<T, E>, ...args: Args) => Promise<Immutable<T>>,
        options?: ActionOptions,
    ) => {
        return createAction<Args, T, E>(state, owner, execute, options);
    };

    const resource: ResourceConstructor = <T, E = unknown>(
        load: (context: ResourceContext<T, E>) => Promise<Immutable<T>>,
        options?: ResourceOptions,
    ) => {
        return createResource<T, E>(state, owner, load, options);
    };

    const batch = (execute: () => void): void => {
        state._batchLevel++;

        try {
            execute();
        } finally {
            if (--state._batchLevel === 0) {
                flushPendingEffects(state);
            }
        }
    };

    const scope = (): Store => {
        return createScopedStore(state, createLifecycleOwner(state, owner));
    };

    const unlink = (): Promise<void> => {
        return Promise.resolve().then(() => {
            unlinkLifecycleOwner(owner);
        });
    };

    return {
        signal,
        untracked,
        effect,
        memo,
        action,
        resource,
        batch,
        scope,
        unlink,
    };
}

function createLifecycleOwner(state: StoreState, parent?: LifecycleOwner): LifecycleOwner {
    const owner: LifecycleOwner = {
        _state: state,
        ...(parent ? { _parent: parent } : {}),
        _children: new Set(),
        _ownedEffects: new Set(),
        _ownedSignals: new Set(),
        _active: parent ? parent._active : true,
    };

    parent?._children.add(new WeakRef(owner));

    return owner;
}

function unlinkLifecycleOwner(owner: LifecycleOwner): void {
    if (!owner._active) {
        return;
    }

    owner._active = false;

    for (const reference of owner._children) {
        const child = reference.deref();

        if (!child) {
            owner._children.delete(reference);
            continue;
        }

        unlinkLifecycleOwner(child);
    }

    for (const signal of owner._ownedSignals) {
        signal._clearDependencies();
    }
    owner._ownedSignals.clear();

    for (const effect of owner._ownedEffects) {
        effect._cancel();
    }
    owner._ownedEffects.clear();
}
