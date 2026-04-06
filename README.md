# `@haragei/signals`

`@haragei/signals` is a lightweight, framework-agnostic TypeScript library for fine-grained reactive state.

It provides:

- signals for reactive state with immutable reads
- memos for derived state
- effects for reactive side effects
- actions for imperative async writes
- resources for async derived state
- stores for isolated reactive graphs

## Installation

```sh
pnpm add @haragei/signals
```

```ts
import { action, batch, effect, memo, resource, signal, subscribe, untracked } from '@haragei/signals';
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

## Usage with React

```sh
pnpm add @haragei/signals @haragei/react-signals react
```

```tsx
import { useSignal, useSignalValue } from '@haragei/react-signals';

export function Counter() {
    const count = useSignal(0);
    const value = useSignalValue(count);

    return (
        <button type="button" onClick={() => count.update((current) => current + 1)}>
            Count: {value}
        </button>
    );
}
```

## Learn More

- [`packages/signals/README.md`](./packages/signals/README.md) for the complete core package overview
- [`packages/signals/docs/api/README.md`](./packages/signals/docs/api/README.md) for the API reference
- [`packages/react-signals`](./packages/react-signals) for the React bindings

## Packages

- [`@haragei/signals`](./packages/signals) - the core framework-agnostic reactive state library
- [`@haragei/react-signals`](./packages/react-signals) - React 19 bindings for `@haragei/signals`

## License

MIT

## See Also

- [Solid.js](https://github.com/solidjs/solid)
- [Preact Signals](https://github.com/preactjs/signals)
