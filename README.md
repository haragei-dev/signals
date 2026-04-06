# `@haragei/signals`

`@haragei/signals` is a lightweight, framework-agnostic TypeScript library for fine-grained reactive state.

It provides:
- signals for mutable state
- memos for derived state
- effects for reactive side effects
- resources for async derived state
- stores for isolated reactive graphs
- scopes for shared-graph teardown boundaries

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

## Core Concepts

### Signals

Signals are mutable reactive values. Reading a signal inside an effect or memo creates a dependency. Updating it re-runs the dependents that use it.

API reference: [`packages/signals/docs/api/signals.md`](./packages/signals/docs/api/signals.md)

### Memos

Memos are derived read-only signals. They recompute automatically when their dependencies change and are best used for idempotent derived values.

API reference: [`packages/signals/docs/api/memos.md`](./packages/signals/docs/api/memos.md)

### Effects

Effects react to signal, memo, and resource changes. They support cleanup callbacks, cancellation, async execution, post-`await` manual dependency tracking via `track()`, and configurable async concurrency behavior.

API reference: [`packages/signals/docs/api/effects.md`](./packages/signals/docs/api/effects.md)

### Resources

Resources model async derived state. They expose loading, ready, and error states, keep stale values while refreshing, and provide imperative controls such as `refresh()`, `abort()`, and `reset()`.

API reference: [`packages/signals/docs/api/resources.md`](./packages/signals/docs/api/resources.md)

### Stores

Stores isolate reactive graphs. The global APIs are convenience wrappers around a default global store, while `createStore()` lets you construct independent stores explicitly. A store can also create child scopes with `store.scope()`, which share the same reactive graph but have their own `unlink()` teardown boundary.

API reference: [`packages/signals/docs/api/store.md`](./packages/signals/docs/api/store.md)

### Utilities

The shared runtime utilities cover batching, untracked reads, and queue primitives used by async effects and resources.

API reference: [`packages/signals/docs/api/utilities.md`](./packages/signals/docs/api/utilities.md)

For the full API documentation landing page, see [`packages/signals/docs/api/README.md`](./packages/signals/docs/api/README.md).

## Packages

- [`@haragei/signals`](./packages/signals) - the core framework-agnostic reactive state library

## License

MIT

## See Also

- [Solid.js](https://github.com/solidjs/solid)
- [Preact Signals](https://github.com/preactjs/signals)
