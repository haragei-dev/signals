import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { equalFunc } from '../equal';
import type { EffectConstructor, SignalConstructor, SignalReader, SignalUpdater } from './types';
import { createStore } from './store';

describe('signal()', () => {
    let signal: SignalConstructor;
    let effect: EffectConstructor;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        effect = store.effect;
    });

    it('Creates a new signal.', () => {
        const [get, set] = signal(0);
        expect(get()).toBe(0);
        set(42);
        expect(get()).toBe(42);
    });

    it('Returns an object with read and update functions.', () => {
        const count = signal(0);

        expect(count).toHaveProperty('read');
        expect(count.read).toBeInstanceOf(Function);
        expectTypeOf(count.read).toEqualTypeOf<SignalReader<number>>();

        expect(count).toHaveProperty('update');
        expect(count.update).toBeInstanceOf(Function);
        expectTypeOf(count.update).toEqualTypeOf<SignalUpdater<number>>();

        expect(count.read()).toBe(0);
        count.update(42);
        expect(count.read()).toBe(42);
    });

    it('Allows setting the value using a function.', () => {
        const [get, set] = signal(0);
        set((prevValue) => prevValue + 1);
        expect(get()).toBe(1);
    });

    it('Does not update when the value is the same.', () => {
        const [get, set] = signal(0);

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(fx).toHaveBeenCalledTimes(1);

        set(0);
        set(0);
        set(0);

        expect(fx).toHaveBeenCalledTimes(1);

        set(1);

        expect(fx).toHaveBeenCalledTimes(2);
    });

    it('Allows customizing the equality check.', () => {
        const [get, set] = signal(0, { equals: equalFunc({ compare: 'loose' }) });

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(fx).toHaveBeenCalledTimes(1);

        // @ts-expect-error - TS2345: Argument of type 'string' is not assignable to parameter of type 'number | ((prevValue: number) => number)'
        set('0');

        expect(fx).toHaveBeenCalledTimes(1);

        set(1);

        expect(fx).toHaveBeenCalledTimes(2);
    });
});
