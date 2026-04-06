import { describe, expect, it, vi } from 'vitest';
import { subscribe } from './subscribe';
import { getReaderOwner } from './store/signal';
import { createStore } from './store/store';
import { deferred, flushPromises } from './test/store-test-helpers';

describe('subscribe()', () => {
    it('attaches owner metadata to signal, memo, resource, and action readers.', async () => {
        const store1 = createStore();
        const store2 = createStore();
        const [signalRead] = store1.signal(1);
        const memoRead = store1.memo(() => signalRead() * 2);
        const [resourceRead] = store1.resource(async () => 1);
        const [actionRead] = store1.action(async () => 1);
        const [otherSignalRead] = store2.signal(2);

        expect(getReaderOwner(signalRead)).toBeDefined();
        expect(getReaderOwner(memoRead)).toBe(getReaderOwner(signalRead));
        expect(getReaderOwner(resourceRead)).toBe(getReaderOwner(signalRead));
        expect(getReaderOwner(actionRead)).toBe(getReaderOwner(signalRead));
        expect(getReaderOwner(otherSignalRead)).not.toBe(getReaderOwner(signalRead));

        await flushPromises();
    });

    it('subscribes to signal changes without notifying on the initial read.', () => {
        const [read, write] = createStore().signal(0);
        const listener = vi.fn();
        const unsubscribe = subscribe(read, listener);

        expect(listener).not.toHaveBeenCalled();

        write(1);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        write(2);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('subscribes to memo changes.', () => {
        const store = createStore();
        const [source, setSource] = store.signal(1);
        const doubled = store.memo(() => source() * 2);
        const listener = vi.fn();
        const unsubscribe = subscribe(doubled, listener);

        setSource(2);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it('subscribes to resource state changes.', async () => {
        const pending = deferred<number>();
        const [read] = createStore().resource(async () => pending.promise);
        const listener = vi.fn();
        const unsubscribe = subscribe(read, listener);

        pending.resolve(1);
        await flushPromises();

        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it('subscribes to action state changes.', async () => {
        const pending = deferred<number>();
        const [read, controls] = createStore().action(async () => pending.promise);
        const listener = vi.fn();
        const unsubscribe = subscribe(read, listener);

        const submitPromise = controls.submit();
        expect(listener).toHaveBeenCalledTimes(1);

        pending.resolve(1);
        await expect(submitPromise).resolves.toBe(1);

        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
    });

    it('rejects readers that were not created by this library.', () => {
        expect(() => {
            subscribe(
                () => 1,
                () => {},
            );
        }).toThrow('Can only subscribe to readers created by @haragei/signals.');
    });
});
