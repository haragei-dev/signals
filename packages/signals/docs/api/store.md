# Store

## Overview

`createStore()` creates an isolated reactive graph with its own signals, memos, effects, actions, resources, batching state, and teardown lifecycle.

`store.scope()` creates a child teardown boundary inside that same graph. Parent and child scopes can react to each other's signals, memos, and resources while both are active.

Store-local APIs follow the same immutable-read contract as the global helpers: reads from `store.signal()`, `store.memo()`, `store.untracked()`, `track()`, `store.action()`, and `store.resource()` return `Immutable<T>` snapshots.

Use stores when you want:

- multiple independent reactive graphs in the same process
- deterministic teardown of a graph through `unlink()`
- nested teardown boundaries through `scope()`
- library-local or request-local reactive state without touching the global store

## Canonical Example

```ts
import { createStore } from '@haragei/signals';

const store = createStore();

const [count, setCount] = store.signal(0);
const doubled = store.memo(() => count() * 2);

const cancel = store.effect(() => {
    console.log(doubled());
});

setCount(1);

cancel();
await store.unlink();
```

## Public API Summary

```ts
interface Store {
    readonly signal: SignalConstructor;
    readonly untracked: UntrackedReader;
    readonly effect: EffectConstructor;
    readonly memo: MemoConstructor;
    readonly action: ActionConstructor;
    readonly resource: ResourceConstructor;
    readonly batch: BatchFunction;
    scope(): Store;
    unlink(): Promise<void>;
}

declare function createStore(): Store;
```

## Full Behavior and Semantics

The global functions:

- `signal()`
- `memo()`
- `effect()`
- `resource()`
- `action()`
- `batch()`
- `untracked()`

are convenience wrappers around a default global store.

`createStore()` gives you an explicit root store object with the same capabilities:

```ts
const store = createStore();

const [count, setCount] = store.signal(0);

store.effect(() => {
    console.log(count());
});
```

All reactive values created through one root store belong to that graph. Signals, memos, effects, and resources from different root stores must not be mixed.

## Store-Local APIs

Each store exposes the same behavior as the global helpers:

- `store.signal()`
- `store.untracked()`
- `store.effect()`
- `store.memo()`
- `store.action()`
- `store.resource()`
- `store.batch()`
- `store.scope()`

They behave the same way as the global APIs, but only within that store's graph or teardown subtree.

## `scope()`

`scope()` creates a child store-like object inside the same reactive graph:

```ts
const store = createStore();
const search = store.scope();

const [session] = store.signal('user-1');
const [query, setQuery] = search.signal('');

search.effect(() => {
    console.log(session(), query());
});

setQuery('signals');
```

Scopes are useful when you want:

- a feature-local teardown boundary without creating a separate graph
- child-owned async effects, resources, or actions that can be disposed together
- parent and child reactive code to observe the same graph

Behavior:

- parent and child scopes react to each other's readers while both are active
- `batch()` is graph-wide across parent and child scopes
- `await child.unlink()` tears down only the child scope and its descendants
- `await parent.unlink()` tears down the whole subtree rooted at that store

After a child scope is unlinked:

- child-owned effects, memos, resources, actions, and descendant scopes become inert
- child-owned signals are still readable and writable
- child-owned signal reads no longer create dependencies
- child-owned signal writes update their value but no longer notify dependents

Use a new `createStore()` root instead of `scope()` when you need isolation rather than teardown scoping.

## `unlink()`

`unlink()` is the store-level teardown mechanism.

```ts
const store = createStore();

store.effect(() => {
    console.log('reactive');
});

await store.unlink();
```

After `unlink()`:

- existing effects and memos become inert
- reads are still allowed
- future updates no longer trigger the unlinked reactive graph

This differs from canceling a single effect:

- canceling an effect stops only that effect
- `unlink()` tears down the whole store graph or scope subtree

Use it as a cleanup step when the store lifetime ends.

## Edge Cases and Gotchas

- Do not mix signals from one root store with effects, memos, or resources from another root store.
- `scope()` shares the parent's graph. Use a new `createStore()` root when you need isolation.
- Creating new reactive state after `unlink()` is not recommended.
- `unlink()` is asynchronous because it tears down async reactive work as well.

## Additional Examples

### Request-local store

```ts
function createRequestState() {
    const store = createStore();
    const session = store.signal(null as string | null);

    return { store, session };
}
```

### Feature scope

```ts
const app = createStore();
const [session] = app.signal('user-1');

function createSearchFeature(parent: Store) {
    const scope = parent.scope();
    const [query, setQuery] = scope.signal('');
    const results = scope.memo(() => `${session()}:${query()}`);

    scope.effect(() => {
        console.log(results());
    });

    return { scope, query, setQuery, results };
}

const search = createSearchFeature(app);
search.setQuery('signals');
await search.scope.unlink();
```

### Store-local resource

```ts
const store = createStore();
const userId = store.signal('');

const [user] = store.resource(async ({ track, signal }) => {
    const id = track(userId);
    const response = await fetch(`/api/users/${id}`, { signal });
    return response.json();
});
```

### Store-local action

```ts
const store = createStore();

const [saveUser, controls] = store.action(async (_context, id: string) => {
    return await saveUserById(id);
});

void controls.submit('user-1');
```

## Related Topics

- [`signals.md`](./signals.md)
- [`memos.md`](./memos.md)
- [`effects.md`](./effects.md)
- [`resources.md`](./resources.md)
- [`utilities.md`](./utilities.md)
