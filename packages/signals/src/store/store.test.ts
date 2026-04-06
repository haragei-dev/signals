import { beforeEach, describe, expect, it, vi } from 'vitest';
import { equalFunc } from '../equal';
import { deferred, flushPromises } from '../test/store-test-helpers';
import {
    type BatchFunction,
    type EffectConstructor,
    type MemoConstructor,
    type SignalConstructor,
    type UntrackedReader,
} from './types';
import { createStore } from './store';

describe('createStore()', () => {
    it('Creates a new store.', () => {
        const store = createStore();
        expect(store).toBeDefined();
        expect(store.signal).toBeInstanceOf(Function);
        expect(store.effect).toBeInstanceOf(Function);
        expect(store.memo).toBeInstanceOf(Function);
        expect(store.action).toBeInstanceOf(Function);
        expect(store.batch).toBeInstanceOf(Function);
        expect(store.untracked).toBeInstanceOf(Function);
        expect(store.scope).toBeInstanceOf(Function);
        expect(store.unlink).toBeInstanceOf(Function);
    });

    it('Effects from one store do not react to signal changes in another store.', () => {
        const store1 = createStore();
        const store2 = createStore();

        let value = 0;
        const [get, set] = store1.signal(value);

        store2.effect(() => {
            value = get();
        });

        expect(value).toBe(0);

        set(1);

        expect(value).toBe(0);
    });
});

describe('untracked()', () => {
    let signal: SignalConstructor;
    let effect: EffectConstructor;
    let untracked: UntrackedReader;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        effect = store.effect;
        untracked = store.untracked;
    });

    it('Reads the value of a signal without tracking it.', () => {
        const [a, setA] = signal(1);
        const [b, setB] = signal(2);

        const fx = vi.fn(() => {
            setA(untracked(a) + b());
        });

        effect(fx);

        expect(a()).toBe(3);
        expect(fx).toHaveBeenCalledTimes(1);

        setA(0);

        expect(a()).toBe(0);
        expect(fx).toHaveBeenCalledTimes(1);

        setB(3);

        expect(a()).toBe(3);
        expect(fx).toHaveBeenCalledTimes(2);
    });

    it('Restores tracking when the untracked reader throws.', () => {
        const [get, set] = signal(0);

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(() => {
            untracked(() => {
                throw new Error('boom');
            });
        }).toThrow('boom');

        set(1);
        set(2);

        expect(fx).toHaveBeenCalledTimes(3);
    });
});

describe('memo()', () => {
    let signal: SignalConstructor;
    let memo: MemoConstructor;
    let effect: EffectConstructor;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        memo = store.memo;
        effect = store.effect;
    });

    it('Creates a new memo.', () => {
        const [get, set] = signal(0);

        const memoized = memo(() => get() * 2);

        expect(memoized()).toBe(0);

        set(42);

        expect(memoized()).toBe(84);
    });

    it('Stops recomputing when its lifetime signal aborts.', () => {
        const [get, set] = signal(1);
        const controller = new AbortController();
        const compute = vi.fn(() => get() * 2);

        const memoized = memo(compute, { signal: controller.signal });

        expect(memoized()).toBe(2);
        expect(compute).toHaveBeenCalledTimes(1);

        set(2);

        expect(memoized()).toBe(4);
        expect(compute).toHaveBeenCalledTimes(2);

        controller.abort();
        set(3);

        expect(memoized()).toBe(4);
        expect(compute).toHaveBeenCalledTimes(2);
    });

    it('Propagates errors thrown by the compute function during creation.', () => {
        expect(() =>
            memo(() => {
                throw new Error('boom');
            }),
        ).toThrow('boom');
    });

    it('Propagates errors thrown by compute through the signal setter that triggers recomputation.', () => {
        const [get, set] = signal(0);
        let shouldThrow = false;

        memo(() => {
            const value = get();
            if (shouldThrow) {
                throw new Error('boom');
            }
            return value * 2;
        });

        shouldThrow = true;

        expect(() => set(1)).toThrow('boom');
    });

    it('Becomes inert after compute throws during recomputation.', () => {
        const [get, set] = signal(0);
        let shouldThrow = false;
        const compute = vi.fn(() => {
            const value = get();
            if (shouldThrow) {
                throw new Error('boom');
            }
            return value * 2;
        });

        const memoized = memo(compute);

        expect(memoized()).toBe(0);
        expect(compute).toHaveBeenCalledTimes(1);

        shouldThrow = true;

        expect(() => set(1)).toThrow('boom');
        expect(compute).toHaveBeenCalledTimes(2);

        shouldThrow = false;

        set(2);
        expect(compute).toHaveBeenCalledTimes(2);
        expect(memoized()).toBe(0);
    });

    it('Does not break the reactive graph when compute throws during recomputation.', () => {
        const [get, set] = signal(0);
        const [other, setOther] = signal(0);
        let shouldThrow = false;

        memo(() => {
            const value = get();
            if (shouldThrow) {
                throw new Error('boom');
            }
            return value;
        });

        const fx = vi.fn(() => {
            other();
        });

        effect(fx);

        expect(fx).toHaveBeenCalledTimes(1);

        shouldThrow = true;

        expect(() => set(1)).toThrow('boom');

        setOther(1);

        expect(fx).toHaveBeenCalledTimes(2);
    });

    it('Allows customizing the equality check.', () => {
        const [get, set] = signal(0);

        const memoized = memo(() => [Math.max(1, get()) * 2], {
            equals: equalFunc(),
        });

        const fx = vi.fn(() => {
            memoized();
        });

        effect(fx);

        expect(memoized()).toEqual([2]);
        expect(fx).toHaveBeenCalledTimes(1);

        set(1);

        expect(memoized()).toEqual([2]);
        expect(fx).toHaveBeenCalledTimes(1);

        set(42);

        expect(memoized()).toEqual([84]);
        expect(fx).toHaveBeenCalledTimes(2);
    });
});

describe('batch()', () => {
    let signal: SignalConstructor;
    let effect: EffectConstructor;
    let batch: BatchFunction;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        effect = store.effect;
        batch = store.batch;
    });

    it('Executes a batch of updates.', () => {
        const [get, set] = signal(0);

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(fx).toHaveBeenCalledTimes(1);

        batch(() => {
            set(1);
            set(2);
            set(3);
        });

        expect(fx).toHaveBeenCalledTimes(2);
    });

    it('Defers flushing until the outermost nested batch completes.', () => {
        const [get, set] = signal(0);

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(fx).toHaveBeenCalledTimes(1);

        batch(() => {
            set(1);

            batch(() => {
                set(2);
            });

            expect(fx).toHaveBeenCalledTimes(1);
        });

        expect(fx).toHaveBeenCalledTimes(2);
    });
});

describe('scope()', () => {
    it('Lets child effects react to parent-owned signals.', () => {
        const store = createStore();
        const child = store.scope();
        const [count, setCount] = store.signal(0);
        const runs: number[] = [];

        child.effect(() => {
            runs.push(count());
        });

        setCount(1);

        expect(runs).toEqual([0, 1]);
    });

    it('Lets parent effects react to child-owned signals while the child is active.', () => {
        const store = createStore();
        const child = store.scope();
        const [count, setCount] = child.signal(0);
        const runs: number[] = [];

        store.effect(() => {
            runs.push(count());
        });

        setCount(1);

        expect(runs).toEqual([0, 1]);
    });

    it('Batches updates across parent and child scopes.', () => {
        const store = createStore();
        const child = store.scope();
        const [left, setLeft] = store.signal(0);
        const [right, setRight] = child.signal(0);
        const fx = vi.fn(() => {
            left();
            right();
        });

        child.effect(fx);

        store.batch(() => {
            setLeft(1);
            setRight(2);
        });

        expect(fx).toHaveBeenCalledTimes(2);
    });

    it('Unlinks only the child subtree when a child scope is disposed.', async () => {
        const store = createStore();
        const child = store.scope();
        const grandchild = child.scope();
        const sibling = store.scope();
        const [count, setCount] = store.signal(0);
        const childRuns: number[] = [];
        const grandchildRuns: number[] = [];
        const siblingRuns: number[] = [];

        child.effect(() => {
            childRuns.push(count());
        });
        grandchild.effect(() => {
            grandchildRuns.push(count());
        });
        sibling.effect(() => {
            siblingRuns.push(count());
        });

        await child.unlink();
        setCount(1);

        expect(childRuns).toEqual([0]);
        expect(grandchildRuns).toEqual([0]);
        expect(siblingRuns).toEqual([0, 1]);
    });

    it('Cascades root unlink through descendant scopes.', async () => {
        const store = createStore();
        const child = store.scope();
        const grandchild = child.scope();
        const [count, setCount] = store.signal(0);
        const rootRuns: number[] = [];
        const childRuns: number[] = [];
        const grandchildRuns: number[] = [];

        store.effect(() => {
            rootRuns.push(count());
        });
        child.effect(() => {
            childRuns.push(count());
        });
        grandchild.effect(() => {
            grandchildRuns.push(count());
        });

        await store.unlink();
        setCount(1);

        expect(rootRuns).toEqual([0]);
        expect(childRuns).toEqual([0]);
        expect(grandchildRuns).toEqual([0]);
    });

    it('Leaves child-owned signals readable and writable, but inert, after child unlink.', async () => {
        const store = createStore();
        const child = store.scope();
        const [count, setCount] = child.signal(0);
        const [gate, setGate] = store.signal(0);
        const runs: number[] = [];

        store.effect(() => {
            gate();
            runs.push(count());
        });

        await child.unlink();

        setCount(1);
        expect(runs).toEqual([0]);

        setGate(1);
        expect(runs).toEqual([0, 1]);

        setCount(2);
        expect(runs).toEqual([0, 1]);

        setGate(2);
        expect(runs).toEqual([0, 1, 2]);
    });

    it('Aborts child-owned async effects when the child scope is unlinked.', async () => {
        const store = createStore();
        const child = store.scope();
        const pending = deferred<void>();
        const signals: AbortSignal[] = [];

        child.effect(async ({ signal }) => {
            signals.push(signal);
            await pending.promise;
        });

        expect(signals).toHaveLength(1);
        expect(signals[0]?.aborted).toBe(false);

        await child.unlink();

        expect(signals[0]?.aborted).toBe(true);

        pending.resolve();
        await flushPromises();
    });
});

describe('unlink()', () => {
    it('Unlinks all effects.', async () => {
        const store = createStore();

        const [a, setA] = store.signal(1);
        const [b, setB] = store.signal(2);
        const [c, setC] = store.signal(3);

        let aValue = 0;
        let bValue = 0;
        let cValue = 0;

        const fx1 = vi.fn(() => {
            aValue = a();
        });

        const fx2 = vi.fn(() => {
            bValue = b();
        });

        const fx3 = vi.fn(() => {
            cValue = c();
        });

        store.effect(fx1);
        store.effect(fx2);
        store.effect(fx3);

        expect(aValue).toBe(1);
        expect(fx1).toHaveBeenCalledTimes(1);

        expect(bValue).toBe(2);
        expect(fx2).toHaveBeenCalledTimes(1);

        expect(cValue).toBe(3);
        expect(fx3).toHaveBeenCalledTimes(1);

        setA(42);
        setB(73);
        setC(100);

        expect(aValue).toBe(42);
        expect(fx1).toHaveBeenCalledTimes(2);

        expect(bValue).toBe(73);
        expect(fx2).toHaveBeenCalledTimes(2);

        expect(cValue).toBe(100);
        expect(fx3).toHaveBeenCalledTimes(2);

        await store.unlink();

        setA(1000);
        setB(2000);
        setC(3000);

        expect(aValue).toBe(42);
        expect(fx1).toHaveBeenCalledTimes(2);

        expect(bValue).toBe(73);
        expect(fx2).toHaveBeenCalledTimes(2);

        expect(cValue).toBe(100);
        expect(fx3).toHaveBeenCalledTimes(2);
    });

    it('Does not unlink effects from other stores.', async () => {
        const store1 = createStore();
        const store2 = createStore();

        const [a, setA] = store1.signal(1);
        const [b, setB] = store2.signal(2);

        let aValue = 0;
        let bValue = 0;

        const fx1 = vi.fn(() => {
            aValue = a();
        });

        const fx2 = vi.fn(() => {
            bValue = b();
        });

        store1.effect(fx1);
        store2.effect(fx2);

        expect(aValue).toBe(1);
        expect(fx1).toHaveBeenCalledTimes(1);

        expect(bValue).toBe(2);
        expect(fx2).toHaveBeenCalledTimes(1);

        setA(42);
        setB(73);

        expect(aValue).toBe(42);
        expect(fx1).toHaveBeenCalledTimes(2);

        expect(bValue).toBe(73);
        expect(fx2).toHaveBeenCalledTimes(2);

        await store1.unlink();

        setA(1000);
        setB(2000);

        expect(aValue).toBe(42);
        expect(fx1).toHaveBeenCalledTimes(2);

        expect(bValue).toBe(2000);
        expect(fx2).toHaveBeenCalledTimes(3);
    });

    it('Aborts in-flight async effects and prevents reruns after unlink.', async () => {
        const store = createStore();
        const [get, set] = store.signal(0);
        const pending = deferred<void>();
        const signals: AbortSignal[] = [];
        const runs: number[] = [];

        store.effect(async ({ signal }) => {
            const value = get();
            runs.push(value);
            signals.push(signal);
            await pending.promise;
        });

        expect(runs).toEqual([0]);
        expect(signals[0]?.aborted).toBe(false);

        await store.unlink();

        expect(signals[0]?.aborted).toBe(true);

        pending.resolve();
        await flushPromises();

        set(1);
        await flushPromises();

        expect(runs).toEqual([0]);
    });

    it('Aborts multiple in-flight async effects on unlink.', async () => {
        const store = createStore();
        const first = deferred<void>();
        const second = deferred<void>();
        const signals: AbortSignal[] = [];

        store.effect(async ({ signal }) => {
            signals.push(signal);
            await first.promise;
        });

        store.effect(async ({ signal }) => {
            signals.push(signal);
            await second.promise;
        });

        expect(signals).toHaveLength(2);
        expect(signals.every((s) => !s.aborted)).toBe(true);

        await store.unlink();

        expect(signals.every((s) => s.aborted)).toBe(true);

        first.resolve();
        second.resolve();
        await flushPromises();
    });
});
