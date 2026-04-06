import { StrictMode, act, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DefaultInvalidationQueue, createStore } from '@haragei/signals';
import type {
    ActionContext,
    ActionControls,
    ActionState,
    ResourceControls,
    ResourceState,
    Signal,
    SignalReader,
} from '@haragei/signals';
import {
    SignalsProvider,
    useSignal,
    useSignalAction,
    useSignalBatch,
    useSignalEffect,
    useSignalMemo,
    useSignalResource,
    useSignalScope,
    useSignalStore,
    useSignalValue,
} from './index';
import { flushMicrotasks, hydrate, render } from './test/react-test-helpers';

describe('React hooks', () => {
    it('useSignal rerenders on updates and preserves signal identity.', async () => {
        let signal!: Signal<{ count: number }>;
        let firstSignal: Signal<{ count: number }> | undefined;

        function App(): React.JSX.Element {
            signal = useSignal({ count: 0 });
            firstSignal ??= signal;

            return <span>{signal.read().count}</span>;
        }

        const result = await render(<App />);

        expect(result.container.textContent).toBe('0');
        expect(signal).toBe(firstSignal);

        await act(async () => {
            signal.update((previous) => ({ count: previous.count + 1 }));
        });

        expect(result.container.textContent).toBe('1');
        expect(signal).toBe(firstSignal);

        await result.unmount();
    });

    it('useSignalValue subscribes to existing core signal, memo, resource, and action readers.', async () => {
        const store = createStore();
        const base = store.signal(1);
        const memo = store.memo(() => base.read() * 2);
        const [resourceRead, resourceControls] = store.resource<number>(async ({ track }) =>
            track(memo),
        );
        const [actionRead, actionControls] = store.action<number, [number]>(
            async (_context: ActionContext<number>, value) => value * 10,
        );

        function App(): React.JSX.Element {
            const signalValue = useSignalValue(base.read);
            const memoValue = useSignalValue(memo);
            const resourceValue = useSignalValue(resourceRead);
            const actionValue = useSignalValue(actionRead);

            return (
                <span>
                    {signalValue}:{memoValue}:{resourceValue.status}:{resourceValue.value ?? 'none'}
                    :{actionValue.status}:{actionValue.value ?? 'none'}
                </span>
            );
        }

        const result = await render(<App />);

        await flushMicrotasks();

        expect(result.container.textContent).toBe('1:2:ready:2:idle:none');

        await act(async () => {
            base.update(3);
        });

        await flushMicrotasks();
        expect(result.container.textContent).toBe('3:6:ready:6:idle:none');

        await act(async () => {
            await actionControls.submit(7);
        });

        expect(result.container.textContent).toBe('3:6:ready:6:success:70');

        resourceControls.abort();
        await result.unmount();
    });

    it('useSignalValue subscribes to hook-created memo, resource, and action readers.', async () => {
        let source!: Signal<number>;
        let actionControls!: ActionControls<[number], number>;

        function Child({
            memoRead,
            resourceRead,
            actionRead,
        }: {
            memoRead: SignalReader<number>;
            resourceRead: SignalReader<ResourceState<number>>;
            actionRead: SignalReader<ActionState<number>>;
        }): React.JSX.Element {
            const memoValue = useSignalValue(memoRead);
            const resourceValue = useSignalValue(resourceRead);
            const actionValue = useSignalValue(actionRead);

            return (
                <span>
                    {memoValue}:{resourceValue.status}:{resourceValue.value ?? 'none'}:
                    {actionValue.status}:{actionValue.value ?? 'none'}
                </span>
            );
        }

        function App(): React.JSX.Element {
            source = useSignal(2);
            const memoRead = useSignalMemo(() => source.read() * 2);
            const [resourceRead] = useSignalResource<number>(async ({ track }) => track(memoRead));
            const [actionRead, controls] = useSignalAction<number, [number]>(
                async (_context, value) => value + source.read(),
            );

            actionControls = controls;

            return (
                <Child memoRead={memoRead} resourceRead={resourceRead} actionRead={actionRead} />
            );
        }

        const result = await render(<App />);

        await flushMicrotasks();
        expect(result.container.textContent).toBe('4:ready:4:idle:none');

        await act(async () => {
            source.update(3);
        });

        await flushMicrotasks();
        expect(result.container.textContent).toBe('6:ready:6:idle:none');

        await act(async () => {
            await actionControls.submit(5);
        });

        expect(result.container.textContent).toBe('6:ready:6:success:8');

        await result.unmount();
    });

    it('useSignalMemo tracks signal changes and reflects the latest render callback semantics.', async () => {
        let setMultiplier: ((value: number) => void) | undefined;
        let source!: Signal<number>;

        function App(): React.JSX.Element {
            const multiplier = useSignal(2);
            source = useSignal(3);
            setMultiplier = multiplier.update;

            const read = useSignalMemo(() => source.read() * multiplier.read());
            const value = useSignalValue(read);

            return <span>{value}</span>;
        }

        const result = await render(<App />);

        expect(result.container.textContent).toBe('6');

        await act(async () => {
            setMultiplier?.(4);
        });

        expect(result.container.textContent).toBe('12');

        await act(async () => {
            source.update(5);
        });

        expect(result.container.textContent).toBe('20');

        await result.unmount();
    });

    it('useSignalMemo forwards equals and signal options to the underlying memo lifecycle.', async () => {
        const controller = new AbortController();
        const equalsCalls: Array<readonly [number, number]> = [];
        let source!: Signal<number>;

        function App(): React.JSX.Element {
            source = useSignal(1);
            const read = useSignalMemo(() => source.read() % 2, {
                signal: controller.signal,
                equals(previous, next) {
                    equalsCalls.push([previous as number, next as number]);
                    return previous === next;
                },
            });

            return <span>{useSignalValue(read)}</span>;
        }

        const result = await render(<App />);

        expect(result.container.textContent).toBe('1');

        await act(async () => {
            source.update(3);
        });

        expect(result.container.textContent).toBe('1');
        expect(equalsCalls).toContainEqual([1, 1]);

        await act(async () => {
            controller.abort();
        });

        await result.unmount();
    });

    it('useSignalEffect reacts to signal changes, uses the latest callback, and cleans up on unmount.', async () => {
        const events: string[] = [];
        let source!: Signal<number>;
        let labelSignal!: Signal<string>;

        function App(): React.JSX.Element {
            source = useSignal(1);
            labelSignal = useSignal('a');

            useSignalEffect(() => {
                const label = labelSignal.read();
                events.push(`run:${label}:${source.read()}`);

                return () => {
                    events.push(`cleanup:${label}`);
                };
            });

            return (
                <span>
                    {labelSignal.read()}:{source.read()}
                </span>
            );
        }

        const result = await render(<App />);

        expect(events).toEqual(['run:a:1']);

        await act(async () => {
            labelSignal.update('b');
        });

        expect(events).toEqual(['run:a:1', 'cleanup:a', 'run:b:1']);

        await act(async () => {
            source.update(2);
        });

        expect(events).toEqual(['run:a:1', 'cleanup:a', 'run:b:1', 'cleanup:b', 'run:b:2']);

        await result.unmount();

        expect(events).toEqual([
            'run:a:1',
            'cleanup:a',
            'run:b:1',
            'cleanup:b',
            'run:b:2',
            'cleanup:b',
        ]);
    });

    it('useSignalEffect supports async options and forwards async errors to the configured handler.', async () => {
        const errors: string[] = [];
        const queue = new DefaultInvalidationQueue();
        let trigger!: Signal<number>;

        function App(): React.JSX.Element {
            trigger = useSignal(0);

            useSignalEffect(
                async ({ track }) => {
                    if (track(trigger.read) > 0) {
                        throw new Error('boom');
                    }
                },
                {
                    concurrency: 'queue',
                    queue,
                    onError: {
                        mode: 'report',
                        handler(error) {
                            errors.push((error as Error).message);
                        },
                    },
                },
            );

            return <span>{trigger.read()}</span>;
        }

        const result = await render(<App />);

        await act(async () => {
            trigger.update(1);
        });

        await flushMicrotasks();
        expect(errors).toEqual(['boom']);

        await result.unmount();
    });

    it('useSignalEffect supports signal-only sync options and concurrency-only async options.', async () => {
        const events: string[] = [];
        const controller = new AbortController();
        let syncSource!: Signal<number>;
        let asyncSource!: Signal<number>;

        function App(): React.JSX.Element {
            syncSource = useSignal(0);
            asyncSource = useSignal(0);

            useSignalEffect(
                () => {
                    events.push(`sync:${syncSource.read()}`);
                },
                { signal: controller.signal },
            );

            useSignalEffect(
                async ({ track }) => {
                    events.push(`async:${track(asyncSource.read)}`);
                },
                { concurrency: 'cancel' },
            );

            return (
                <span>
                    {syncSource.read()}:{asyncSource.read()}
                </span>
            );
        }

        const result = await render(<App />);

        expect(events).toEqual(['sync:0', 'async:0']);

        await act(async () => {
            controller.abort();
        });

        await act(async () => {
            syncSource.update(1);
            asyncSource.update(1);
        });

        await flushMicrotasks();
        expect(events).toEqual(['sync:0', 'async:0', 'async:1']);

        await result.unmount();
    });

    it('useSignalResource starts idle, resolves, keeps controls stable, and aborts on unmount.', async () => {
        let controls!: ResourceControls;
        let firstControls: ResourceControls | undefined;
        let resolveLoad: (() => void) | undefined;
        let cleanedUp = false;

        function App(): React.JSX.Element {
            const [read, nextControls] = useSignalResource<number>(
                async ({ onCleanup, signal }) => {
                    onCleanup(() => {
                        cleanedUp = true;
                    });

                    await new Promise<void>((resolve) => {
                        resolveLoad = resolve;

                        signal.addEventListener(
                            'abort',
                            () => {
                                resolve();
                            },
                            { once: true },
                        );
                    });

                    return 4;
                },
            );

            controls = nextControls;
            firstControls ??= controls;

            const state = useSignalValue(read);

            return (
                <span>
                    {state.status}:{state.value ?? 'none'}
                </span>
            );
        }

        const result = await render(<App />);

        expect(result.container.textContent).toBe('loading:none');
        expect(controls).toBe(firstControls);

        await act(async () => {
            resolveLoad?.();
            await Promise.resolve();
        });

        expect(result.container.textContent).toBe('ready:4');
        expect(controls).toBe(firstControls);

        await act(async () => {
            controls.refresh();
        });

        expect(result.container.textContent).toBe('loading:4');

        await act(async () => {
            controls.abort();
        });

        expect(result.container.textContent).toBe('loading:4');

        await act(async () => {
            controls.reset();
        });

        expect(result.container.textContent).toBe('idle:none');

        await result.unmount();
        expect(cleanedUp).toBe(true);
    });

    it('useSignalResource forwards async options to the underlying resource.', async () => {
        const errors: string[] = [];
        const queue = new DefaultInvalidationQueue();
        let source!: Signal<number>;

        function App(): React.JSX.Element {
            source = useSignal(0);

            const [read] = useSignalResource<number>(
                async ({ track }) => {
                    const value = track(source.read);

                    if (value > 0) {
                        throw new Error('resource-error');
                    }

                    return value;
                },
                {
                    concurrency: 'queue',
                    queue,
                    writes: 'settled',
                    onError: {
                        mode: 'report',
                        handler(error) {
                            errors.push((error as Error).message);
                        },
                    },
                },
            );

            return <span>{useSignalValue(read).status}</span>;
        }

        const result = await render(<App />);

        await flushMicrotasks();

        await act(async () => {
            source.update(1);
        });

        await flushMicrotasks();
        expect(errors).toEqual(['resource-error']);

        await result.unmount();
    });

    it('useSignalAction starts idle, preserves stable controls, supports submitWith(), and rejects pending work on unmount.', async () => {
        let controls!: ActionControls<[number], number>;
        let firstControls: ActionControls<[number], number> | undefined;
        let resolveRun: ((value: number) => void) | undefined;

        function App(): React.JSX.Element {
            const [read, nextControls] = useSignalAction<number, [number]>(
                async ({ signal }, value) => {
                    return await new Promise<number>((resolve, reject) => {
                        resolveRun = resolve;
                        signal.addEventListener(
                            'abort',
                            () => {
                                const error = new Error();
                                error.name = 'AbortError';
                                reject(error);
                            },
                            { once: true },
                        );
                    }).then((result) => result + value);
                },
            );

            controls = nextControls;
            firstControls ??= controls;

            const state = useSignalValue(read);

            return (
                <span>
                    {state.status}:{state.value ?? 'none'}
                </span>
            );
        }

        const result = await render(<App />);

        expect(result.container.textContent).toBe('idle:none');
        expect(controls).toBe(firstControls);

        const controller = new AbortController();

        let aborted!: Promise<unknown>;

        await act(async () => {
            aborted = controls.submitWith({ signal: controller.signal }, 1).catch((error) => error);
            await Promise.resolve();
        });

        await act(async () => {
            controller.abort();
        });

        expect(await aborted).toMatchObject({ name: 'AbortError' });
        expect(result.container.textContent).toBe('idle:none');

        let canceled!: Promise<unknown>;

        await act(async () => {
            canceled = controls.submit(2).catch((error) => error);
            await Promise.resolve();
        });

        expect(result.container.textContent).toBe('pending:none');
        expect(controls).toBe(firstControls);

        await act(async () => {
            controls.abort();
        });

        expect(await canceled).toMatchObject({ name: 'AbortError' });
        expect(result.container.textContent).toBe('idle:none');

        let resetCanceled!: Promise<unknown>;

        await act(async () => {
            resetCanceled = controls.submit(2).catch((error) => error);
            await Promise.resolve();
        });

        expect(result.container.textContent).toBe('pending:none');

        await act(async () => {
            controls.reset();
        });

        expect(await resetCanceled).toMatchObject({ name: 'AbortError' });
        expect(result.container.textContent).toBe('idle:none');

        let pending!: Promise<unknown>;

        await act(async () => {
            pending = controls.submit(2).catch((error) => error);
            await Promise.resolve();
        });

        expect(result.container.textContent).toBe('pending:none');

        await result.unmount();
        expect(await pending).toMatchObject({ name: 'AbortError' });

        const afterUnmount = controls.submit(3).catch((error) => error);
        expect(await afterUnmount).toMatchObject({ name: 'AbortError' });

        void resolveRun;
    });

    it('SignalsProvider isolates stores per subtree.', async () => {
        const updates: Array<(value: number) => void> = [];

        function Counter(): React.JSX.Element {
            const value = useSignal(0);
            updates.push(value.update);

            return <span>{value.read()}</span>;
        }

        const result = await render(
            <div>
                <SignalsProvider>
                    <Counter />
                </SignalsProvider>
                <SignalsProvider>
                    <Counter />
                </SignalsProvider>
            </div>,
        );

        expect(result.container.textContent).toBe('00');

        await act(async () => {
            updates[0]?.(1);
        });

        expect(result.container.textContent).toBe('10');

        await result.unmount();
    });

    it('useSignalScope returns a scoped store stable across rerenders.', async () => {
        const root = createStore();
        let firstScope: ReturnType<typeof useSignalScope> | undefined;
        let latestScope: ReturnType<typeof useSignalScope> | undefined;
        let rerender!: () => void;

        function App(): React.JSX.Element {
            const scope = useSignalScope(root);
            const [tick, setTick] = useState(0);

            rerender = () => {
                setTick((value) => value + 1);
            };
            firstScope ??= scope;
            latestScope = scope;

            return (
                <SignalsProvider store={scope}>
                    <span>{tick}</span>
                </SignalsProvider>
            );
        }

        const result = await render(<App />);

        await act(async () => {
            rerender();
        });

        expect(latestScope).toBe(firstScope);

        await result.unmount();
    });

    it('useSignalScope can create a client scope without an explicit parent or provider.', async () => {
        function Child(): React.JSX.Element {
            const count = useSignal(1);

            return <span>{count.read()}</span>;
        }

        function App(): React.JSX.Element {
            const scope = useSignalScope();

            return (
                <SignalsProvider store={scope}>
                    <Child />
                </SignalsProvider>
            );
        }

        const result = await render(<App />);

        expect(result.container.textContent).toBe('1');

        await result.unmount();
    });

    it('useSignalScope lets child-scoped hooks react to parent-owned signals.', async () => {
        const root = createStore();
        const [session, setSession] = root.signal('a');

        function Child(): React.JSX.Element {
            const sessionRead = useSignalMemo(() => session());
            return <span>{useSignalValue(sessionRead)}</span>;
        }

        function App(): React.JSX.Element {
            const scope = useSignalScope(root);

            return (
                <SignalsProvider store={scope}>
                    <Child />
                </SignalsProvider>
            );
        }

        const result = await render(<App />);
        expect(result.container.textContent).toBe('a');

        await act(async () => {
            setSession('b');
        });

        expect(result.container.textContent).toBe('b');

        await result.unmount();
    });

    it('useSignalScope unlinks the previous scope when the parent store changes.', async () => {
        const rootA = createStore();
        const rootB = createStore();
        const [countA, setCountA] = rootA.signal(0);
        const [countB, setCountB] = rootB.signal(0);
        const seen: string[] = [];
        let swapParent!: () => void;
        const queuedCallbacks: Array<() => void> = [];
        const queueMicrotaskSpy = vi
            .spyOn(globalThis, 'queueMicrotask')
            .mockImplementation((callback: VoidFunction) => {
                queuedCallbacks.push(callback);
            });

        function Child({ label, read }: { label: string; read: SignalReader<number> }): null {
            useSignalEffect(() => {
                seen.push(`${label}:${read()}`);
            });

            return null;
        }

        function App(): React.JSX.Element {
            const [useFirstParent, setUseFirstParent] = useState(true);
            const parent = useFirstParent ? rootA : rootB;
            const read = useFirstParent ? countA : countB;
            const label = useFirstParent ? 'a' : 'b';
            const scope = useSignalScope(parent);

            swapParent = () => {
                setUseFirstParent(false);
            };

            return (
                <SignalsProvider store={scope}>
                    <Child label={label} read={read} />
                </SignalsProvider>
            );
        }

        try {
            const result = await render(<App />);

            expect(seen).toEqual(['a:0']);

            await act(async () => {
                swapParent();
            });

            expect(seen).toEqual(['a:0', 'b:0']);

            await act(async () => {
                setCountA(1);
                setCountB(1);
            });

            expect(seen).toEqual(['a:0', 'b:0', 'b:1']);

            await result.unmount();

            await act(async () => {
                while (queuedCallbacks.length > 0) {
                    queuedCallbacks.shift()?.();
                }

                await Promise.resolve();
            });
        } finally {
            queueMicrotaskSpy.mockRestore();
        }
    });

    it('useSignalScope unlinks the owned scope on unmount.', async () => {
        const root = createStore();
        const [count, setCount] = root.signal(0);
        const seen: number[] = [];

        function Child(): null {
            useSignalEffect(() => {
                seen.push(count());
            });

            return null;
        }

        function App(): React.JSX.Element {
            const scope = useSignalScope(root);

            return (
                <SignalsProvider store={scope}>
                    <Child />
                </SignalsProvider>
            );
        }

        const result = await render(<App />);
        expect(seen).toEqual([0]);

        await result.unmount();
        await flushMicrotasks();

        await act(async () => {
            setCount(1);
        });

        expect(seen).toEqual([0]);
    });

    it('useSignalScope does not leak active scoped effects in StrictMode.', async () => {
        const root = createStore();
        const [count, setCount] = root.signal(0);
        const seen: number[] = [];

        function Child(): null {
            useSignalEffect(() => {
                seen.push(count());
            });

            return null;
        }

        function App(): React.JSX.Element {
            const scope = useSignalScope(root);

            return (
                <SignalsProvider store={scope}>
                    <Child />
                </SignalsProvider>
            );
        }

        const result = await render(
            <StrictMode>
                <App />
            </StrictMode>,
        );

        await act(async () => {
            setCount(1);
        });

        expect(seen.filter((value) => value === 1)).toHaveLength(1);

        await result.unmount();
        await flushMicrotasks();

        await act(async () => {
            setCount(2);
        });

        expect(seen).not.toContain(2);
    });

    it('useSignalAction forwards async options to the underlying action.', async () => {
        const errors: string[] = [];
        const queue = new DefaultInvalidationQueue();
        let controls!: ActionControls<[boolean], number>;

        function App(): React.JSX.Element {
            const [read, nextControls] = useSignalAction<number, [boolean]>(
                async (_context, shouldFail) => {
                    if (shouldFail) {
                        throw new Error('action-error');
                    }

                    return 1;
                },
                {
                    concurrency: 'queue',
                    queue,
                    onError: {
                        mode: 'report',
                        handler(error) {
                            errors.push((error as Error).message);
                        },
                    },
                },
            );

            controls = nextControls;

            return <span>{useSignalValue(read).status}</span>;
        }

        const result = await render(<App />);
        let rejected!: Promise<unknown>;

        await act(async () => {
            rejected = controls.submit(true).catch((error) => error);
            await Promise.resolve();
        });

        expect(await rejected).toBeInstanceOf(Error);
        expect(errors).toEqual(['action-error']);

        await result.unmount();
    });

    it('useSignalBatch batches signal-driven effect reruns.', async () => {
        const events: string[] = [];
        let batch!: ReturnType<typeof useSignalBatch>;
        let left!: Signal<number>;
        let right!: Signal<number>;

        function App(): React.JSX.Element {
            left = useSignal(0);
            right = useSignal(0);
            batch = useSignalBatch();

            useSignalEffect(() => {
                events.push(`${left.read()}:${right.read()}`);
            });

            return (
                <span>
                    {left.read()}:{right.read()}
                </span>
            );
        }

        const result = await render(<App />);

        expect(events).toEqual(['0:0']);

        await act(async () => {
            batch(() => {
                left.update(1);
                right.update(2);
            });
        });

        expect(events).toEqual(['0:0', '1:2']);
        expect(result.container.textContent).toBe('1:2');

        await result.unmount();
    });

    it('useSignalStore falls back to a client-global store and provider-backed markup hydrates safely.', async () => {
        function Counter(): React.JSX.Element {
            const store = useSignalStore();
            const signal = useSignal(1);

            return (
                <span>
                    {store === undefined ? 'bad' : 'ok'}:{signal.read()}
                </span>
            );
        }

        const client = await render(<Counter />);
        expect(client.container.textContent).toBe('ok:1');
        await client.unmount();

        const markup = renderToString(
            <SignalsProvider>
                <Counter />
            </SignalsProvider>,
        );

        const container = document.createElement('div');
        container.innerHTML = markup;
        document.body.append(container);

        await hydrate(
            container,
            <SignalsProvider>
                <Counter />
            </SignalsProvider>,
        );

        expect(container.textContent).toBe('ok:1');

        container.remove();
    });

    it('SignalsProvider uses an explicitly provided store.', async () => {
        const store = createStore();

        function App(): React.JSX.Element {
            return <span>{useSignalStore() === store ? 'same' : 'different'}</span>;
        }

        const result = await render(
            <SignalsProvider store={store}>
                <App />
            </SignalsProvider>,
        );

        expect(result.container.textContent).toBe('same');

        await result.unmount();
    });
});
