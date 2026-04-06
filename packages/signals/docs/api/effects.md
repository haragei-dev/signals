# Effects

## Overview

Effects run reactive side effects whenever the signals, memos, or resources they depend on change. `@haragei/signals` supports both synchronous and asynchronous effects.

This page covers `effect()`, `EffectContext`, `EffectFunction`, `AsyncEffectContext`, `AsyncEffectFunction`, `EffectConstructor`, `EffectOptions`, `AsyncEffectOptions`, `AsyncEffectErrorOptions`, `AsyncEffectErrorInfo`, `AsyncEffectErrorMode`, and `AsyncEffectConcurrency`.

## Canonical Example

```ts
import { effect, memo, signal } from '@haragei/signals';

const [count, setCount] = signal(0);
const doubled = memo(() => count() * 2);

const cancel = effect(() => {
    console.log('doubled =', doubled());
});

setCount(1);
setCount(2);

cancel();
```

## Public API Summary

```ts
interface EffectOptions {
    readonly signal?: AbortSignal;
}

type AsyncEffectConcurrency = 'cancel' | 'concurrent' | 'queue';
type AsyncEffectErrorMode = 'report' | 'cancel' | 'throw';

interface AsyncEffectErrorInfo {
    readonly generation: number;
    readonly concurrency: AsyncEffectConcurrency;
    readonly signal: AbortSignal;
    readonly canceled: boolean;
}

interface AsyncEffectErrorOptions {
    readonly mode?: AsyncEffectErrorMode;
    readonly handler?: (error: unknown, info: AsyncEffectErrorInfo) => void;
}

interface AsyncEffectOptions extends EffectOptions {
    readonly concurrency?: AsyncEffectConcurrency;
    readonly queue?: InvalidationQueue;
    readonly onError?: AsyncEffectErrorOptions;
}

interface EffectContext {
    cancel(): void;
    track<T>(read: SignalReader<T>): Immutable<T>;
    readonly signal: AbortSignal;
    onCleanup(cleanup: () => void): void;
}

type EffectFunction = (context: EffectContext) => void | (() => void);
type AsyncEffectContext = EffectContext;
type AsyncEffectFunction = (context: EffectContext) => Promise<void>;

interface EffectConstructor {
    (execute: EffectFunction, options?: EffectOptions): () => void;
    (execute: AsyncEffectFunction, options?: AsyncEffectOptions): () => void;
}

declare function effect(execute: EffectFunction, options?: EffectOptions): () => void;
declare function effect(execute: AsyncEffectFunction, options?: AsyncEffectOptions): () => void;
```

## Full Behavior and Semantics

### Synchronous effects

Synchronous effects:

- run immediately when created
- track the signal, memo, and resource readers they use
- re-run when those dependencies change
- may return a cleanup callback

All reactive reads inside an effect follow the immutable-read contract. If a signal or memo contains an object or array, the value you receive is typed as `Immutable<T>`.

```ts
const [enabled] = signal(true);

effect(() => {
    if (!enabled()) {
        return;
    }

    const id = setInterval(() => {
        console.log('tick');
    }, 1000);

    return () => clearInterval(id);
});
```

Cleanup callbacks run before the next execution and when the effect is canceled.

### Asynchronous effects

Async effects use the same `effect()` API:

```ts
const endpoint = signal('/api/data');

effect(async ({ signal }) => {
    const response = await fetch(endpoint(), { signal });
    console.log(await response.json());
});
```

Important tracking rule:

- reads before the first `await` are tracked automatically
- reads after the first `await` are not tracked automatically

To add dependencies after the first `await`, call `track()` explicitly:

```ts
effect(async ({ track }) => {
    await Promise.resolve();

    const a = track(signalA);
    const b = track(signalB);

    console.log(a + b);
});
```

`track()` behaves like a tracked read, not like an escape hatch. It still returns `Immutable<T>`.

Async effects do not return cleanup callbacks. Instead, register cleanup through `context.onCleanup()`:

```ts
const roomId = signal('general');

effect(async ({ onCleanup, signal }) => {
    const socket = new WebSocket(`wss://example.com/rooms/${roomId()}`);

    onCleanup(() => {
        socket.close();
    });

    const id = roomId();

    await fetch('/api/presence', {
        method: 'POST',
        body: JSON.stringify({ roomId: id }),
        signal: signal,
    });

    socket.send(JSON.stringify({ type: 'join', roomId: id }));
});
```

## Options and Related Types

### `EffectOptions`

```ts
interface EffectOptions {
    readonly signal?: AbortSignal;
}
```

Passing an `AbortSignal` ties the effect lifetime to that signal:

```ts
const controller = new AbortController();

effect(
    () => {
        console.log(count());
    },
    {
        signal: controller.signal,
    },
);

controller.abort();
```

### `EffectContext`

`EffectContext` is passed to both sync and async effects.

#### `cancel()`

Stops the effect permanently.

When `cancel()` is called:

- the current run is canceled
- any registered cleanup for the current run is executed
- the effect is removed from all currently tracked signal, memo, and resource dependencies
- future updates of those dependencies no longer re-run the effect

In practice, this means the effect becomes inert after cancellation.

```ts
effect(({ cancel }) => {
    if (count() >= 10) {
        cancel();
    }
    console.log(count());
});
```

#### `track(read)`

Explicitly tracks a signal, memo, or resource read for the current async run.

```ts
effect(async ({ track }) => {
    await Promise.resolve();
    const selectedId = track(id);
    console.log(selectedId);
});
```

The returned value is still immutable at the type level. If you need to change a structured value reactively, write a new value through the corresponding signal updater instead of mutating the tracked result.

#### `signal`

An `AbortSignal` for the current effect run.

```ts
const walletId = signal('wallet-1');

effect(async ({ signal }) => {
    await fetch(`/api/wallet/${walletId()}`, { signal });
});
```

#### `onCleanup(cleanup)`

Registers cleanup for the current run. This is especially important for async effects.

```ts
const pollMs = signal(1000);

effect(async ({ onCleanup }) => {
    const timer = setInterval(() => { console.log('polling...'); }, pollMs());
    onCleanup(() => clearInterval(timer));
});
```

### `AsyncEffectOptions`

```ts
interface AsyncEffectOptions extends EffectOptions {
    readonly concurrency?: 'cancel' | 'concurrent' | 'queue';
    readonly queue?: InvalidationQueue;
    readonly onError?: AsyncEffectErrorOptions;
}
```

#### `concurrency`

Controls what happens when an async effect is invalidated while a previous run is still pending.

Pick the mode based on the kind of side effect you are driving:

- Use `'cancel'` for latest-state synchronization where stale work should be abandoned.
- Use `'concurrent'` when every run matters and overlap is acceptable.
- Use `'queue'` when runs must not overlap, but a new invalidation should still trigger another pass later.

##### `'cancel'` (default)

Abort the stale run and re-run once after it settles.

```ts
const userId = signal('u1');

effect(
    async ({ signal }) => {
        const id = userId();
        const response = await fetch(`/api/profile-preview/${id}`, { signal });
        profilePreviewCache.set(id, await response.json());
    },
    {
        concurrency: 'cancel',
    },
);
```

This is the right default for request-like work tied to the latest UI state, such as route-driven fetches, live previews, or search suggestions.

If `userId()` changes from `'u1'` to `'u2'` to `'u3'` while the first request is pending, the `'u1'` run is aborted and the effect coalesces those invalidations into one rerun for the latest state.

##### `'concurrent'`

Allow overlapping runs.

```ts
const route = signal('/home');

effect(
    async () => {
        await analytics.sendPageView({ route: route() });
    },
    {
        concurrency: 'concurrent',
    },
);
```

Use this when every run represents a meaningful event of its own, such as analytics, audit logging, or best-effort background warming.

For example, if the user navigates through three pages quickly, you may want all three page-view uploads to continue even if they finish out of order.

##### `'queue'`

Queue invalidations and run them serially.

```ts
const draft = signal('');

effect(
    async () => {
        await draftsStore.write('current', draft());
    },
    {
        concurrency: 'queue',
    },
);
```

Use this when the target system must be written to one run at a time, such as IndexedDB persistence, a sync worker, or a hardware bridge that cannot handle overlap.

Queued runs start in invalidation order, but each run reads the current reactive state when it begins. That means multiple queued reruns can still observe the same latest snapshot if the value changed again while earlier work was pending.

When `concurrency` is `'queue'`, you may pass a custom queue.

### `InvalidationQueue` and `DefaultInvalidationQueue`

See [`utilities.md`](./utilities.md) for the full queue API. In effect code, the common pattern is:

```ts
import { DefaultInvalidationQueue, effect } from '@haragei/signals';

const queue = new DefaultInvalidationQueue();

effect(
    async () => {
        await syncStep(step());
    },
    {
        concurrency: 'queue',
        queue,
    },
);
```

Use a custom queue when default FIFO reruns are not the right fit. For example, a latest-only queue can collapse a backlog of autosave invalidations into a single final rerun.

### `onError`

```ts
interface AsyncEffectErrorOptions {
    readonly mode?: 'report' | 'cancel' | 'throw';
    readonly handler?: (error: unknown, info: AsyncEffectErrorInfo) => void;
}
```

#### `mode: 'report'`

Report the error and keep the effect alive. This is the default.

```ts
const selectedId = signal('broken');

effect(
    async () => {
        const id = selectedId();
        throw new Error(`boom: ${id}`);
    },
    {
        onError: {
            mode: 'report',
        },
    },
);
```

#### `mode: 'cancel'`

Report the error, then cancel the effect.

```ts
const selectedId = signal('broken');

effect(
    async () => {
        const id = selectedId();
        throw new Error(`boom: ${id}`);
    },
    {
        onError: {
            mode: 'cancel',
        },
    },
);
```

#### `mode: 'throw'`

Rethrow the error to the host on a microtask boundary.

```ts
const selectedId = signal('broken');

effect(
    async () => {
        const id = selectedId();
        throw new Error(`boom: ${id}`);
    },
    {
        onError: {
            mode: 'throw',
        },
    },
);
```

#### `handler`

Inspect the error before the selected mode is applied.

```ts
const selectedId = signal('broken');

effect(
    async () => {
        const id = selectedId();
        throw new Error(`boom: ${id}`);
    },
    {
        onError: {
            handler(error, info) {
                console.error('generation', info.generation, error);
            },
        },
    },
);
```

`AsyncEffectErrorInfo` includes:

- `generation`
- `concurrency`
- `signal`
- `canceled`

## Edge Cases and Gotchas

- Creating an effect with an already-aborted `AbortSignal` returns a no-op cancel function.
- Async reads after the first `await` are intentionally untracked unless wrapped in `track()`.
- Reads inside later callbacks such as `setInterval`, `setTimeout`, promise handlers, or DOM event handlers do not become dependencies of the surrounding effect.
- `queue` is valid only when `concurrency` is `'queue'`.
- Cleanup callbacks are idempotent for a single run.
- Effects detect synchronous self-dependency cycles and throw `Cyclic dependency detected`, including cycles created during explicit `track()` reads.

Incorrect:

```ts
effect(() => {
    const id = setInterval(() => {
        console.log(count()); // does not subscribe this effect to count
    }, 1000);

    return () => clearInterval(id);
});
```

If you need the effect to depend on `count`, read it while the effect itself is running:

```ts
effect(() => {
    const current = count(); // tracked

    const id = setInterval(() => {
        console.log(current);
    }, 1000);

    return () => clearInterval(id);
});
```

## Additional Examples

### Cancel from inside the effect

```ts
effect(({ cancel }) => {
    if (!enabled()) {
        cancel();
    }
    console.log(count());
});
```

### Shared AbortSignal for multiple effects

```ts
const controller = new AbortController();

effect(
    () => {
        console.log(a());
    },
    { signal: controller.signal },
);

effect(
    () => {
        console.log(b());
    },
    { signal: controller.signal },
);
```

### Post-`await` dependency tracking

```ts
effect(async ({ track }) => {
    await Promise.resolve();
    console.log(track(selectedUserId));
});
```

## Related Topics

- [`signals.md`](./signals.md)
- [`memos.md`](./memos.md)
- [`resources.md`](./resources.md)
- [`utilities.md`](./utilities.md)
- [`store.md`](./store.md)
