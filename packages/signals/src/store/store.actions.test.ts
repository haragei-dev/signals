import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { deferred, flushPromises } from '../test/store-test-helpers';
import {
    type ActionConstructor,
    type ActionContext,
    type ActionOptions,
    type ActionState,
    type ActionSubmitOptions,
    type AsyncInvalidation,
    type Immutable,
    type SignalConstructor,
} from './types';
import { DefaultInvalidationQueue } from './queue';
import { createStore } from './store';

describe('action()', () => {
    let signal: SignalConstructor;
    let action: ActionConstructor;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        action = store.action;
    });

    it('Exposes action types in the public API.', () => {
        expectTypeOf<ActionOptions>().toExtend<{
            signal?: AbortSignal;
            concurrency?: 'cancel' | 'concurrent' | 'queue';
        }>();
        expectTypeOf<ActionSubmitOptions>().toExtend<{
            signal?: AbortSignal;
        }>();
        expectTypeOf<ActionContext<number>>().toExtend<{
            signal: AbortSignal;
            onCleanup: (cleanup: () => void) => void;
            previous: Immutable<ActionState<number>>;
        }>();

        const [, controls] = action(
            async (
                _context: ActionContext<{ id: number; payload: { name: string } }>,
                id: number,
                payload: { name: string },
            ) => ({
                id,
                payload,
            }),
        );

        const submit: (
            id: number,
            payload: { name: string },
        ) => Promise<Immutable<{ id: number; payload: { name: string } }>> = controls.submit;
        void submit;
        const submitWith: (
            options: ActionSubmitOptions,
            id: number,
            payload: { name: string },
        ) => Promise<Immutable<{ id: number; payload: { name: string } }>> = controls.submitWith;
        void submitWith;

        const [, zeroArgControls] = action(async () => 1);
        const zeroArgSubmit: () => Promise<number> = zeroArgControls.submit;
        void zeroArgSubmit;
        const zeroArgSubmitWith: (options: ActionSubmitOptions) => Promise<number> =
            zeroArgControls.submitWith;
        void zeroArgSubmitWith;

        action(async (context: ActionContext<number>) => {
            void context.signal.aborted;
            void context.previous.status;
            context.onCleanup(() => {});
            // @ts-expect-error actions do not expose track()
            void context.track;
            // @ts-expect-error actions do not expose cancel()
            void context.cancel;
            return 1;
        });

        action(async () => 1, { signal: new AbortController().signal });
    });

    it('Does not run until submit() is called.', () => {
        const run = vi.fn(async (_context: ActionContext<number>, value: number) => value * 2);
        const [read] = action(run);

        expect(run).not.toHaveBeenCalled();
        expect(read()).toEqual({
            status: 'idle',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Rejects all submits when the action lifetime signal is already aborted.', async () => {
        const controller = new AbortController();
        controller.abort();

        const [read, controls] = action(async () => 1, { signal: controller.signal });

        await expect(controls.submit()).rejects.toMatchObject({ name: 'AbortError' });
        await expect(
            controls.submitWith({ signal: new AbortController().signal }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        controls.abort();
        controls.reset();
        expect(read()).toEqual({
            status: 'idle',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Rejects submitWith() immediately when the submit signal is already aborted.', async () => {
        const controller = new AbortController();
        controller.abort();

        const [read, controls] = action(
            async (_context: ActionContext<number>, value: number) => value,
        );

        await expect(controls.submitWith({ signal: controller.signal }, 1)).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(read()).toEqual({
            status: 'idle',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Rejects submitWith() when a submit signal aborts before the executor starts running.', async () => {
        const eagerAbortSignal = {
            aborted: false,
            addEventListener(_type: string, listener: () => void): void {
                listener();
            },
            removeEventListener(): void {},
        } as unknown as AbortSignal;

        const run = vi.fn(async (_context: ActionContext<number>, value: number) => value);
        const [read, controls] = action(run);

        await expect(controls.submitWith({ signal: eagerAbortSignal }, 1)).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(run).not.toHaveBeenCalled();
        expect(read()).toEqual({
            status: 'idle',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Transitions from idle to pending to success and resolves submit() with the result.', async () => {
        const pending = deferred<number>();
        const [read, controls] = action(async () => pending.promise);

        const submitPromise = controls.submit();

        expect(read()).toEqual({
            status: 'pending',
            value: undefined,
            error: undefined,
            isStale: false,
        });

        pending.resolve(42);
        await expect(submitPromise).resolves.toBe(42);

        expect(read()).toEqual({
            status: 'success',
            value: 42,
            error: undefined,
            isStale: false,
        });
    });

    it('Transitions from pending to error and rejects submit() with the thrown error.', async () => {
        const [read, controls] = action<number, [], Error>(async () => {
            throw new Error('boom');
        });

        await expect(controls.submit()).rejects.toThrow('boom');
        await flushPromises();

        expect(read()).toMatchObject({
            status: 'error',
            value: undefined,
            isStale: false,
        });
        expect((read().error as Error).message).toBe('boom');
    });

    it('Does not track signal reads before or after await.', async () => {
        const [source, setSource] = signal(1);
        const runs: Array<[number, number]> = [];
        const [read, controls] = action(async () => {
            const before = source();
            await Promise.resolve();
            const after = source();
            runs.push([before, after]);
            return before + after;
        });

        await expect(controls.submit()).resolves.toBe(2);
        expect(runs).toEqual([[1, 1]]);
        expect(read().value).toBe(2);

        setSource(2);
        await flushPromises();

        expect(runs).toEqual([[1, 1]]);
        expect(read().value).toBe(2);
    });

    it('Keeps the previous successful value while pending.', async () => {
        const pending = deferred<number>();
        let run = 0;
        const [read, controls] = action(async () => {
            run++;
            return run === 1 ? 1 : pending.promise;
        });

        await expect(controls.submit()).resolves.toBe(1);

        const secondSubmit = controls.submit();

        expect(read()).toEqual({
            status: 'pending',
            value: 1,
            error: undefined,
            isStale: true,
        });

        pending.resolve(2);
        await expect(secondSubmit).resolves.toBe(2);
    });

    it('Runs action cleanups registered through onCleanup and returns to idle when an initial submit is aborted.', async () => {
        const pending = deferred<number>();
        const cleanup = vi.fn();
        const [read, controls] = action(async (context: ActionContext<number>) => {
            context.onCleanup(cleanup);
            return pending.promise;
        });

        const submitPromise = controls.submit();

        expect(read()).toEqual({
            status: 'pending',
            value: undefined,
            error: undefined,
            isStale: false,
        });

        controls.abort();

        await expect(submitPromise).rejects.toMatchObject({ name: 'AbortError' });
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(read()).toEqual({
            status: 'idle',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Aborts only the matching active submitWith() run and restores the last settled state.', async () => {
        const pending = deferred<number>();
        const [read, controls] = action(
            async ({ signal }: ActionContext<number>, value: number) => {
                if (value === 1) {
                    return 1;
                }

                return await new Promise<number>((resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => {
                            reject(createAbortError());
                        },
                        { once: true },
                    );
                    pending.promise.then(resolve, reject);
                });
            },
        );

        await expect(controls.submit(1)).resolves.toBe(1);

        const controller = new AbortController();
        const submitPromise = controls.submitWith({ signal: controller.signal }, 2);

        expect(read()).toEqual({
            status: 'pending',
            value: 1,
            error: undefined,
            isStale: true,
        });

        controller.abort();

        await expect(submitPromise).rejects.toMatchObject({ name: 'AbortError' });
        expect(read()).toEqual({
            status: 'success',
            value: 1,
            error: undefined,
            isStale: false,
        });
    });

    it('Stops the action when its lifetime signal aborts, restores the last settled state, and rejects future submits.', async () => {
        const controller = new AbortController();
        const pending = deferred<number>();
        const [read, controls] = action(
            async (_context: ActionContext<number>, value: number) => {
                if (value === 1) {
                    return 1;
                }

                return pending.promise;
            },
            { concurrency: 'queue', signal: controller.signal },
        );

        await expect(controls.submit(1)).resolves.toBe(1);

        const activeSubmit = controls.submit(2);
        const queuedSubmit = controls.submit(3);

        controller.abort();

        await expect(activeSubmit).rejects.toMatchObject({ name: 'AbortError' });
        await expect(queuedSubmit).rejects.toMatchObject({ name: 'AbortError' });
        await expect(controls.submit(4)).rejects.toMatchObject({ name: 'AbortError' });
        await expect(
            controls.submitWith({ signal: new AbortController().signal }, 5),
        ).rejects.toMatchObject({ name: 'AbortError' });

        expect(read()).toEqual({
            status: 'success',
            value: 1,
            error: undefined,
            isStale: false,
        });
    });

    it('Clears the visible error on resubmit and retains the previous value when present.', async () => {
        const [source, setSource] = signal(0);
        const pending = deferred<number>();
        const [read, controls] = action<number, [], Error>(async () => {
            if (source() === 0) {
                return 1;
            }
            if (source() === 1) {
                throw new Error('boom');
            }
            return pending.promise;
        });

        await expect(controls.submit()).resolves.toBe(1);
        setSource(1);
        await expect(controls.submit()).rejects.toThrow('boom');

        expect(read()).toMatchObject({
            status: 'error',
            value: 1,
            isStale: true,
        });

        setSource(2);
        const resubmit = controls.submit();

        expect(read()).toEqual({
            status: 'pending',
            value: 1,
            error: undefined,
            isStale: true,
        });

        pending.resolve(2);
        await expect(resubmit).resolves.toBe(2);
    });

    it('Restores the previous error state when abort() cancels a resubmitted action.', async () => {
        const pending = deferred<number>();
        let run = 0;
        const [read, controls] = action<number, [], Error>(async () => {
            run++;
            if (run === 1) {
                throw new Error('boom');
            }

            return pending.promise;
        });

        await expect(controls.submit()).rejects.toThrow('boom');

        const resubmit = controls.submit();

        expect(read()).toMatchObject({
            status: 'pending',
            value: undefined,
            error: undefined,
            isStale: false,
        });

        controls.abort();

        await expect(resubmit).rejects.toMatchObject({ name: 'AbortError' });
        expect(read()).toMatchObject({
            status: 'error',
            value: undefined,
            isStale: false,
        });
        expect((read().error as Error).message).toBe('boom');
    });

    it('Rejects aborted runs by default when a newer submit replaces them.', async () => {
        const first = deferred<number>();
        const [read, controls] = action(
            async ({ signal }: ActionContext<number>, value: number) =>
                new Promise<number>((resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => {
                            reject(createAbortError());
                        },
                        { once: true },
                    );

                    if (value === 1) {
                        first.promise.then(resolve, reject);
                    } else {
                        resolve(value);
                    }
                }),
        );

        const firstSubmit = controls.submit(1);
        const secondSubmit = controls.submit(2);

        await expect(firstSubmit).rejects.toMatchObject({ name: 'AbortError' });
        await expect(secondSubmit).resolves.toBe(2);
        expect(read().value).toBe(2);
    });

    it('Drops superseded pending reruns in cancel mode and keeps only the latest submit.', async () => {
        const first = deferred<number>();
        const run = vi.fn(async (_context: ActionContext<number>, value: number) => {
            if (value === 1) {
                return first.promise;
            }
            return value;
        });
        const [read, controls] = action(run);

        const firstSubmit = controls.submit(1);
        const secondSubmit = controls.submit(2);
        const thirdSubmit = controls.submit(3);

        await expect(firstSubmit).rejects.toMatchObject({ name: 'AbortError' });
        await expect(secondSubmit).rejects.toMatchObject({ name: 'AbortError' });

        first.resolve(1);
        await flushPromises();

        await expect(thirdSubmit).resolves.toBe(3);
        expect(read().value).toBe(3);
        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls.map(([, value]) => value)).toEqual([1, 3]);
    });

    it('Rejects a pending cancel-mode rerun when abort() clears the replacement trigger and restores idle.', async () => {
        const first = deferred<number>();
        const [read, controls] = action(async (_context: ActionContext<number>, value: number) => {
            if (value === 1) {
                return first.promise;
            }

            return value;
        });

        const firstSubmit = controls.submit(1);
        const secondSubmit = controls.submit(2);

        controls.abort();

        await expect(firstSubmit).rejects.toMatchObject({ name: 'AbortError' });
        await expect(secondSubmit).rejects.toMatchObject({ name: 'AbortError' });
        expect(read()).toEqual({
            status: 'idle',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Allows overlapping submits in concurrent mode while visible state stays latest-submit-wins.', async () => {
        const first = deferred<number>();
        const second = deferred<number>();
        const starts: number[] = [];
        const [read, controls] = action(
            async (_context: ActionContext<number>, value: number) => {
                starts.push(value);

                if (value === 1) {
                    return first.promise;
                }

                return second.promise;
            },
            { concurrency: 'concurrent' },
        );

        const firstSubmit = controls.submit(1);
        const secondSubmit = controls.submit(2);

        second.resolve(2);
        await expect(secondSubmit).resolves.toBe(2);
        expect(read().value).toBe(2);

        first.resolve(1);
        await expect(firstSubmit).resolves.toBe(1);
        expect(read().value).toBe(2);
        expect(starts).toEqual([1, 2]);
    });

    it('Aborts only the matching concurrent submitWith() run.', async () => {
        const first = deferred<number>();
        const second = deferred<number>();
        const firstController = new AbortController();
        const starts: number[] = [];
        const [read, controls] = action(
            async ({ signal }: ActionContext<number>, value: number) => {
                starts.push(value);

                return await new Promise<number>((resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => {
                            reject(createAbortError());
                        },
                        { once: true },
                    );

                    if (value === 1) {
                        first.promise.then(resolve, reject);
                    } else {
                        second.promise.then(resolve, reject);
                    }
                });
            },
            { concurrency: 'concurrent' },
        );

        const firstSubmit = controls.submitWith({ signal: firstController.signal }, 1);
        const secondSubmit = controls.submit(2);

        firstController.abort();
        await expect(firstSubmit).rejects.toMatchObject({ name: 'AbortError' });

        second.resolve(2);
        await expect(secondSubmit).resolves.toBe(2);
        expect(read()).toEqual({
            status: 'success',
            value: 2,
            error: undefined,
            isStale: false,
        });
        expect(starts).toEqual([1, 2]);
    });

    it('Queues submits in order when queue concurrency is selected.', async () => {
        const first = deferred<number>();
        const second = deferred<number>();
        const third = deferred<number>();
        const starts: number[] = [];
        const [read, controls] = action(
            async (_context: ActionContext<number>, value: number) => {
                starts.push(value);

                if (value === 1) {
                    return first.promise;
                }
                if (value === 2) {
                    return second.promise;
                }

                return third.promise;
            },
            { concurrency: 'queue' },
        );

        const firstSubmit = controls.submit(1);
        const secondSubmit = controls.submit(2);
        const thirdSubmit = controls.submit(3);

        expect(starts).toEqual([1]);

        first.resolve(1);
        await expect(firstSubmit).resolves.toBe(1);
        await flushPromises();
        expect(starts).toEqual([1, 2]);

        second.resolve(2);
        await expect(secondSubmit).resolves.toBe(2);
        await flushPromises();
        expect(starts).toEqual([1, 2, 3]);

        third.resolve(3);
        await expect(thirdSubmit).resolves.toBe(3);
        expect(read().value).toBe(3);
    });

    it('Rejects queued submitWith() calls aborted before they start and keeps the active run intact.', async () => {
        const first = deferred<number>();
        const starts: number[] = [];
        const controller = new AbortController();
        const [read, controls] = action(
            async ({ signal }: ActionContext<number>, value: number) => {
                starts.push(value);

                return await new Promise<number>((resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => {
                            reject(createAbortError());
                        },
                        { once: true },
                    );

                    if (value === 1) {
                        first.promise.then(resolve, reject);
                    } else {
                        resolve(value);
                    }
                });
            },
            { concurrency: 'queue' },
        );

        const activeSubmit = controls.submit(1);
        const queuedSubmit = controls.submitWith({ signal: controller.signal }, 2);

        controller.abort();

        await expect(queuedSubmit).rejects.toMatchObject({ name: 'AbortError' });
        expect(starts).toEqual([1]);
        expect(read()).toEqual({
            status: 'pending',
            value: undefined,
            error: undefined,
            isStale: false,
        });

        first.resolve(1);
        await expect(activeSubmit).resolves.toBe(1);
        expect(read()).toEqual({
            status: 'success',
            value: 1,
            error: undefined,
            isStale: false,
        });
    });

    it('Rejects queued submits when abort() clears the queue and restores the previous settled state.', async () => {
        const first = deferred<number>();
        const [read, controls] = action(
            async (_context: ActionContext<number>, value: number) => {
                if (value === 1) {
                    return 1;
                }

                return first.promise;
            },
            { concurrency: 'queue' },
        );

        await expect(controls.submit(1)).resolves.toBe(1);

        const activeSubmit = controls.submit(2);
        const queuedSubmit = controls.submit(3);

        controls.abort();

        await expect(activeSubmit).rejects.toMatchObject({ name: 'AbortError' });
        await expect(queuedSubmit).rejects.toMatchObject({ name: 'AbortError' });

        expect(read()).toEqual({
            status: 'success',
            value: 1,
            error: undefined,
            isStale: false,
        });
    });

    it('Rejects active and queued submits when reset() is called and returns to idle.', async () => {
        const active = deferred<number>();
        const [read, controls] = action(
            async (_context: ActionContext<number>, value: number) => {
                if (value === 1) {
                    return 1;
                }

                return active.promise;
            },
            { concurrency: 'queue' },
        );

        await expect(controls.submit(1)).resolves.toBe(1);

        const activeSubmit = controls.submit(2);
        const queuedSubmit = controls.submit(3);

        controls.reset();

        await expect(activeSubmit).rejects.toMatchObject({ name: 'AbortError' });
        await expect(queuedSubmit).rejects.toMatchObject({ name: 'AbortError' });
        expect(read()).toEqual({
            status: 'idle',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Cancels queued submits when onError mode cancel is used.', async () => {
        const handler = vi.fn();
        const [read, controls] = action(
            async (_context: ActionContext<number>, value: number) => {
                if (value === 1) {
                    throw new Error('boom');
                }

                return value;
            },
            {
                concurrency: 'queue',
                onError: { mode: 'cancel', handler },
            },
        );

        const firstSubmit = controls.submit(1);
        const queuedSubmit = controls.submit(2);

        await expect(firstSubmit).rejects.toThrow('boom');
        await expect(queuedSubmit).rejects.toMatchObject({ name: 'AbortError' });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(read()).toMatchObject({
            status: 'error',
            value: undefined,
            isStale: false,
        });
    });

    it('Rejects custom queues unless queue concurrency is selected for actions.', () => {
        const queue = new DefaultInvalidationQueue<AsyncInvalidation>();

        expect(() => {
            action(async () => 1, { concurrency: 'cancel', queue });
        }).toThrow('The queue option can only be used when concurrency is set to "queue"');
    });

    it('Treats synchronously throwing executors as rejected runs.', async () => {
        const [read, controls] = action<number, [], Error>((() => {
            throw new Error('boom');
        }) as unknown as (context: ActionContext<number, Error>) => Promise<number>);

        await expect(controls.submit()).rejects.toThrow('boom');
        await flushPromises();

        expect(read()).toMatchObject({
            status: 'error',
            value: undefined,
            isStale: false,
        });
        expect((read().error as Error).message).toBe('boom');
    });

    it('Stops actions on store.unlink(), rejects affected submits, restores the last settled state, and rejects future submits.', async () => {
        const store = createStore();
        const active = deferred<number>();
        const [read, controls] = store.action(
            async (_context: ActionContext<number>, value: number) => {
                if (value === 1) {
                    return active.promise;
                }

                return value;
            },
            { concurrency: 'queue' },
        );

        await expect(controls.submit(0)).resolves.toBe(0);

        const activeSubmit = controls.submit(1);
        const queuedSubmit = controls.submit(2);

        await store.unlink();

        await expect(activeSubmit).rejects.toMatchObject({ name: 'AbortError' });
        await expect(queuedSubmit).rejects.toMatchObject({ name: 'AbortError' });
        await expect(controls.submit(3)).rejects.toMatchObject({ name: 'AbortError' });
        await expect(
            controls.submitWith({ signal: new AbortController().signal }, 4),
        ).rejects.toMatchObject({ name: 'AbortError' });

        controls.abort();
        controls.reset();

        expect(read()).toEqual({
            status: 'success',
            value: 0,
            error: undefined,
            isStale: false,
        });
    });
});

function createAbortError(): Error {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}
