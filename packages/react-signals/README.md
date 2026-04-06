# @haragei/react-signals

React 19 bindings for [`@haragei/signals`](https://www.npmjs.com/package/@haragei/signals).

This package keeps the core signal/resource/action model intact and adds a small React-facing hook layer on top of it.

## Installation

```bash
pnpm add @haragei/signals @haragei/react-signals react
```

## API

- `SignalsProvider`
- `useSignalStore()`
- `useSignal(initialValue, options?)`
- `useSignalValue(read)`
- `useSignalMemo(compute, options?)`
- `useSignalEffect(execute, options?)`
- `useSignalResource(load, options?)`
- `useSignalAction(execute, options?)`
- `useSignalScope(parent?)`
- `useSignalBatch()`

All signal/resource/action values keep the core library's immutable-read typing.

## Basic usage

```tsx
import { useSignal, useSignalEffect } from '@haragei/react-signals';

export function Counter() {
    const count = useSignal(0);

    useSignalEffect(() => {
        console.log('count changed:', count.read());
    });

    return (
        <button onClick={() => count.update((value) => value + 1)}>
            {count.read()}
        </button>
    );
}
```

## Existing readers

`useSignalValue()` is the generic React bridge for any reader created by `@haragei/signals`, including readers returned by the React hooks in this package.

```tsx
import { createStore } from '@haragei/signals';
import { useSignalValue } from '@haragei/react-signals';

const store = createStore();
const source = store.signal(1);
const doubled = store.memo(() => source.read() * 2);

export function Value() {
    const value = useSignalValue(doubled);
    return <span>{value}</span>;
}
```

## Scoped subtrees

`useSignalScope()` creates a child scope from the current store and unlinks it on unmount. Use it when a subtree should share the parent graph but own its own teardown lifecycle.

```tsx
import { SignalsProvider, useSignal, useSignalScope } from '@haragei/react-signals';

function SearchScope({ children }: React.PropsWithChildren) {
    const scope = useSignalScope();
    return <SignalsProvider store={scope}>{children}</SignalsProvider>;
}

function SearchPanel() {
    const query = useSignal('');

    return (
        <input
            value={query.read()}
            onChange={(event) => query.update(event.target.value)}
        />
    );
}
```

Pass an explicit parent store when ownership lives outside the current provider tree:

```tsx
import { createStore } from '@haragei/signals';
import { SignalsProvider, useSignalScope } from '@haragei/react-signals';

const root = createStore();

function DetachedScope() {
    const scope = useSignalScope(root);
    return <SignalsProvider store={scope}>{/* ... */}</SignalsProvider>;
}
```

Use `SignalsProvider store={existingStore}` when the provided store is owned somewhere else and should not be unlinked by the current component.

## Resources

`useSignalResource()` mirrors the core `resource()` API. It starts from an idle React-visible state and creates the underlying resource after commit.

This is especially important for SSR: hook-created resources do not start loading on the server. They render as `idle` during SSR and begin their normal `idle -> loading -> ready/error` lifecycle only after hydration on the client.

```tsx
import { useSignal, useSignalResource } from '@haragei/react-signals';

export function SearchResults() {
    const query = useSignal('signals');
    const [results] = useSignalResource(async ({ track }) => {
        const currentQuery = track(query.read);
        const response = await fetch(`/api/search?q=${encodeURIComponent(currentQuery)}`);
        return (await response.json()) as Array<{ id: string; title: string }>;
    });

    const state = results();

    if (state.status === 'loading') {
        return <p>Loading…</p>;
    }

    if (state.status === 'error') {
        return <p>Failed.</p>;
    }

    return (
        <ul>
            {(state.value ?? []).map((result) => (
                <li key={result.id}>{result.title}</li>
            ))}
        </ul>
    );
}
```

## Actions

`useSignalAction()` mirrors the core imperative `action()` API. It does not wrap React form actions and it does not replace `useActionState()`.

Like resources, hook-created actions stay in `idle` during SSR because the underlying action instance is created after commit on the client.

```tsx
import { useSignalAction } from '@haragei/react-signals';

export function SaveButton() {
    const [saveState, save] = useSignalAction(async (_context, payload: { title: string }) => {
        const response = await fetch('/api/save', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        return (await response.json()) as { ok: true };
    });

    return (
        <button
            disabled={saveState().status === 'pending'}
            onClick={() => {
                void save.submit({ title: 'Signals' });
            }}
        >
            Save
        </button>
    );
}
```

If you need submit-scoped cancellation, use `submitWith()`:

```tsx
const controller = new AbortController();
void save.submitWith({ signal: controller.signal }, { title: 'Signals' });
```

## SSR

For server rendering, wrap creator hooks in `SignalsProvider`.

```tsx
import { SignalsProvider, useSignal } from '@haragei/react-signals';

function App() {
    const count = useSignal(1);
    return <span>{count.read()}</span>;
}

export function Root() {
    return (
        <SignalsProvider>
            <App />
        </SignalsProvider>
    );
}
```

Without a provider, creator hooks throw during server rendering because this package intentionally does not use a server-global store.

`useSignalScope()` also needs a provider-backed parent during SSR unless you pass an explicit parent store.

Hook-created async primitives are intentionally client-started:

- `useSignalResource()` renders `idle` on the server and starts only after hydration.
- `useSignalAction()` also renders `idle` on the server.
- This means a hydrated client may briefly show the SSR `idle` state before transitioning into `loading` or `pending`.

That behavior is intentional. This package does not try to run hook-local async work during SSR.

When passing `options.signal` to `useSignalMemo()`, `useSignalEffect()`, `useSignalResource()`, or `useSignalAction()`, keep the signal identity stable. Passing a freshly created `AbortSignal` on every render will intentionally tear down and recreate the underlying primitive on every render because the signal instance is part of that hook's lifecycle identity.

## `useTransition()` and `batch()`

`useSignalBatch()` and React transitions solve different problems:

- `useSignalBatch()` coalesces signal invalidation work inside the signal store.
- `startTransition()` marks React updates as non-urgent.

When you need both, compose them:

```tsx
import { startTransition } from 'react';
import { useSignalBatch } from '@haragei/react-signals';

const batch = useSignalBatch();

startTransition(() => {
    batch(() => {
        // multiple signal updates
    });
});
```

## `useOptimistic()`

There is no dedicated optimistic-state hook in v1. The recommended pattern is to compose React's `useOptimistic()` with `useSignalValue()` and `useSignalAction()`.

```tsx
import { useOptimistic, useTransition } from 'react';
import { useSignalAction, useSignalValue } from '@haragei/react-signals';

function Todos({ todosRead }: { todosRead: () => readonly string[] }) {
    const todos = useSignalValue(todosRead);
    const [optimisticTodos, addOptimisticTodo] = useOptimistic(
        todos,
        (current, title: string) => [...current, title],
    );
    const [, saveTodo] = useSignalAction(async (_context, title: string) => title);
    const [, startTransition] = useTransition();

    function submit(title: string) {
        startTransition(async () => {
            addOptimisticTodo(title);
            await saveTodo.submit(title);
        });
    }

    return (
        <ul>
            {optimisticTodos.map((title) => (
                <li key={title}>{title}</li>
            ))}
        </ul>
    );
}
```
