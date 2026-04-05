import { createAction } from './action';
import { createEffect } from './effect';
import { flushPendingEffects } from './flush';
import type { StoreState } from './internal';
import { createResource } from './resource';
import { createSignal, readUntracked } from './signal';
import type {
    ActionConstructor,
    ActionOptions,
    ActionContext,
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

class SignalStore implements Store {
    readonly #state: StoreState = {
        _batchLevel: 0,
        _isUpdating: false,
        _isTracking: true,
        _pendingEffects: new Set(),
        _runs: [],
        _activeEffects: new Set(),
    };

    public signal = <T>(initialValue: T | Immutable<T>, options?: SignalOptions) => {
        return createSignal(this.#state, initialValue, options);
    };

    public untracked: UntrackedReader = <T>(read: () => Immutable<T>): Immutable<T> => {
        return readUntracked(this.#state, read);
    };

    public effect: EffectConstructor = (
        execute: EffectFunction | AsyncEffectFunction,
        options?: EffectOptions | AsyncEffectOptions,
    ): (() => void) => {
        const internalOptions = options && {
            _isMemo: false,
            ...(options.signal !== undefined ? { _signal: options.signal } : {}),
            ...('queue' in options && options.queue !== undefined ? { _queue: options.queue } : {}),
            ...('concurrency' in options && options.concurrency !== undefined
                ? { _concurrency: options.concurrency }
                : {}),
            ...('onError' in options && options.onError !== undefined
                ? { _onError: options.onError }
                : {}),
        };

        return createEffect(this.#state, execute, internalOptions);
    };

    public memo: MemoConstructor = <T>(
        compute: () => T,
        options?: SignalOptions & EffectOptions,
    ): SignalReader<T> => {
        const [read, write] = createSignal<T>(this.#state, undefined as T, options);

        const internalOptions = {
            _signal: options?.signal,
            _isMemo: true,
        };

        createEffect(this.#state, () => write(compute()), {
            _isMemo: internalOptions._isMemo,
            ...(internalOptions._signal !== undefined ? { _signal: internalOptions._signal } : {}),
        });

        return read;
    };

    public action: ActionConstructor = <T, Args extends readonly unknown[] = [], E = unknown>(
        execute: (context: ActionContext<T, E>, ...args: Args) => Promise<Immutable<T>>,
        options?: ActionOptions,
    ) => {
        return createAction<Args, T, E>(this.#state, execute, options);
    };

    public resource: ResourceConstructor = <T, E = unknown>(
        load: (context: ResourceContext<T, E>) => Promise<Immutable<T>>,
        options?: ResourceOptions,
    ) => {
        return createResource<T, E>(this.#state, load, options);
    };

    public batch = (execute: () => void): void => {
        this.#state._batchLevel++;

        try {
            execute();
        } finally {
            if (--this.#state._batchLevel === 0) {
                flushPendingEffects(this.#state);
            }
        }
    };

    public unlink = (): Promise<void> => {
        return Promise.resolve().then(() => {
            for (const fx of this.#state._activeEffects) {
                fx._cancel();
            }
            this.#state._activeEffects.clear();
        });
    };
}

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
    return new SignalStore();
}
