import { structuralEqual } from '../equal';
import type { EffectInstance, StoreState } from './internal';
import { flushPendingEffects } from './flush';
import type { Immutable, Signal, SignalOptions, SignalReader, SignalUpdater } from './types';

export function createSignal<T>(
    state: StoreState,
    initialValue: T | Immutable<T>,
    { equals = structuralEqual }: SignalOptions = {},
): Signal<T> {
    const dependencies = new Set<(typeof state._runs)[number]>();
    let value = initialValue as Immutable<T>;

    const read = (): Immutable<T> => {
        if (state._isTracking) {
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

        const effects = new Set<EffectInstance>();

        for (const run of dependencies) {
            effects.add(run._effect);
        }

        for (const fx of effects) {
            state._pendingEffects.add(fx);
        }

        flushPendingEffects(state);
    };

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
