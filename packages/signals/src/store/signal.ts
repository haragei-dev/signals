import { structuralEqual } from '../equal';
import type { EffectInstance, LifecycleOwner, OwnedSignal, StoreState } from './internal';
import { flushPendingEffects } from './flush';
import type { Immutable, Signal, SignalOptions, SignalReader, SignalUpdater } from './types';

export const READER_OWNER = Symbol();
export const READER_LIFETIME_OWNER = Symbol();

type OwnedReader<T> = SignalReader<T> & {
    [READER_OWNER]?: StoreState;
    [READER_LIFETIME_OWNER]?: LifecycleOwner;
};

export function getReaderOwner<T>(read: SignalReader<T>): StoreState | undefined {
    return (read as OwnedReader<T>)[READER_OWNER];
}

export function createSignal<T>(
    state: StoreState,
    owner: LifecycleOwner,
    initialValue: T | Immutable<T>,
    { equals = structuralEqual }: SignalOptions = {},
): Signal<T> {
    const dependencies = new Set<(typeof state._runs)[number]>();
    let value = initialValue as Immutable<T>;

    const read = (): Immutable<T> => {
        if (owner._active && state._isTracking) {
            const run = state._runs.at(-1);
            if (run?._isTracking && !dependencies.has(run)) {
                dependencies.add(run);
                run._onDependencyCleanup(() => dependencies.delete(run));
            }
        }

        return value as Immutable<T>;
    };

    const write: SignalUpdater<T> = (newValue) => {
        newValue = (
            typeof newValue === 'function'
                ? (newValue as (prevValue: Immutable<T>) => T | Immutable<T>)(value)
                : newValue
        ) as Immutable<T>;

        if (equals(value, newValue)) {
            return;
        }

        value = newValue;

        if (!owner._active) {
            return;
        }

        const effects = new Set<EffectInstance>();

        for (const run of dependencies) {
            effects.add(run._effect);
        }

        for (const fx of effects) {
            state._pendingEffects.add(fx);
        }

        flushPendingEffects(state);
    };

    (read as OwnedReader<T>)[READER_OWNER] = state;
    (read as OwnedReader<T>)[READER_LIFETIME_OWNER] = owner;

    owner._ownedSignals.add({
        _clearDependencies(): void {
            dependencies.clear();
        },
    } satisfies OwnedSignal);

    const signal = [read, write] as unknown as Signal<T>;
    signal.read = read;
    signal.update = write;
    return signal;
}

export function readUntracked<T>(state: StoreState, read: SignalReader<T>): Immutable<T> {
    const wasTracking = state._isTracking;

    state._isTracking = false;

    try {
        return read();
    } finally {
        state._isTracking = wasTracking;
    }
}
