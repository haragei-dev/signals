import { structuralEqual } from '../equal';
import type { EffectInstance, StoreState } from './internal';
import { flushPendingEffects } from './flush';
import type { Signal, SignalOptions, SignalReader, SignalUpdater } from './types';

const signalTuple = class SignalTuple<T> extends Array<SignalReader<T> | SignalUpdater<T>> {
    public readonly read: SignalReader<T>;
    public readonly update: SignalUpdater<T>;

    constructor(read: SignalReader<T>, update: SignalUpdater<T>) {
        super(2);
        this.read = this[0] = read;
        this.update = this[1] = update;
    }
};

export function createSignal<T>(
    state: StoreState,
    initialValue: T,
    { equals = structuralEqual }: SignalOptions = {},
): Signal<T> {
    const dependencies = new Set<(typeof state._runs)[number]>();
    let value = initialValue;

    const read = (): T => {
        if (state._isTracking) {
            const run = state._runs.at(-1);
            if (run?._isTracking && !dependencies.has(run)) {
                dependencies.add(run);
                run._onDependencyCleanup(() => dependencies.delete(run));
            }
        }
        return value;
    };

    const write = (newValue: T | ((prevValue: T) => T)): void => {
        newValue = newValue instanceof Function ? newValue(value) : newValue;

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

    return new signalTuple(read, write) as unknown as Signal<T>;
}

export function readUntracked<T>(state: StoreState, read: SignalReader<T>): T {
    const wasTracking = state._isTracking;

    state._isTracking = false;

    try {
        return read();
    } finally {
        state._isTracking = wasTracking;
    }
}
