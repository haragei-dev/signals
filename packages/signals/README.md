# `@haragei/signals`

`@haragei/signals` is a lightweight, framework-agnostic TypeScript library for fine-grained reactive state.

It provides:

- signals for reactive state with immutable reads
- memos for derived state
- effects for reactive side effects
- resources for async derived state
- stores for isolated reactive graphs

## Installation

```sh
pnpm add @haragei/signals
```

```ts
import { batch, effect, memo, resource, signal, untracked } from '@haragei/signals';
```

## Quick Start

```ts
import { effect, memo, signal } from '@haragei/signals';

const [count, setCount] = signal(0);
const doubleCount = memo(() => count() * 2);

effect(() => {
    console.log(`${count()} x 2 = ${doubleCount()}`);
});

setCount(1);
setCount(2);
```

## Async Example

```ts
import { effect, resource, signal } from '@haragei/signals';

type Wallet = { id: string; balance: number };

const walletId = signal('wallet-1');

const [wallet] = resource<Wallet>(async ({ signal }) => {
    const id = walletId.read();
    const response = await fetch(`/api/wallets/${id}`, { signal });
    return response.json();
});

effect(() => {
    const state = wallet();

    if (state.status === 'loading') {
        console.log('Loading wallet...');
    }

    if (state.status === 'ready') {
        console.log(state.value.balance);
    }
});
```

## Immutable Reads

Signals can store objects, arrays, and other structured values, but reactive reads are typed as immutable snapshots.

This is intentional: mutating a value returned from `read()`, `untracked()`, `track()`, a memo, or a resource does not notify dependents, so it would break the reactive model.

```ts
const [todos, setTodos] = signal([{ title: 'Write docs', done: false }]);

// todos()[0].done = true; // Type error: reads are immutable

setTodos((previous) => {
    return previous.map((todo, index) => (index === 0 ? { ...todo, done: true } : todo));
});
```

If you want a change to be reactive, compute and write a new value instead of mutating the current one in place.

## Core Concepts

### Signals

Signals hold reactive state. Reading a signal inside an effect or memo creates a dependency. Updating it re-runs the dependents that use it. Signal reads are typed as immutable, so objects and arrays must be replaced rather than mutated in place.

API reference: [`docs/api/signals.md`](./docs/api/signals.md)

### Memos

Memos are derived read-only signals. They recompute automatically when their dependencies change, expose immutable reads, and are best used for idempotent derived values.

API reference: [`docs/api/memos.md`](./docs/api/memos.md)

### Effects

Effects react to signal, memo, and resource changes. They support cleanup callbacks, cancellation, async execution, post-`await` manual dependency tracking via `track()`, and configurable async concurrency behavior. All values read inside effects follow the same immutable-read contract.

API reference: [`docs/api/effects.md`](./docs/api/effects.md)

### Resources

Resources model async derived state. They expose loading, ready, and error states, keep stale values while refreshing, and provide imperative controls such as `refresh()`, `abort()`, and `reset()`. Resource state values and `previous` snapshots are typed as immutable.

API reference: [`docs/api/resources.md`](./docs/api/resources.md)

### Stores

Stores isolate reactive graphs. The global APIs are convenience wrappers around a default global store, while `createStore()` lets you construct independent stores explicitly.

API reference: [`docs/api/store.md`](./docs/api/store.md)

### Utilities

The shared runtime utilities cover batching, untracked reads, and queue primitives used by async effects and resources.

API reference: [`docs/api/utilities.md`](./docs/api/utilities.md)

For the full API documentation landing page, see [`docs/api/README.md`](./docs/api/README.md).

## License

MIT

## See Also

- [Solid.js](https://github.com/solidjs/solid)
- [Preact Signals](https://github.com/preactjs/signals)
