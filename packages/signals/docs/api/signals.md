# Signals

## Overview

Signals are the fundamental reactive values in `@haragei/signals`. A signal stores a value, exposes a reader and updater, and participates in dependency tracking when read inside a memo or effect.

Signals may hold mutable JavaScript values such as objects and arrays, but reads are typed as immutable snapshots. This prevents in-place mutation patterns that would not trigger reactive updates.

This page covers `signal()`, `Signal`, `SignalOptions`, `SignalReader`, `SignalUpdater`, and `SignalConstructor`.

## Canonical Example

```ts
import { signal } from '@haragei/signals';

const [count, setCount] = signal(0);

console.log(count()); // 0

setCount(1);

console.log(count()); // 1
```

## Public API Summary

```ts
type Immutable<T> = /* exported deep immutable helper */;
type SignalReader<T> = () => Immutable<T>;
type SignalUpdater<T> = (
  value: T | Immutable<T> | ((prevValue: Immutable<T>) => T | Immutable<T>)
) => void;

interface SignalOptions {
  readonly equals?: (a: unknown, b: unknown) => boolean;
}

type Signal<T> =
  readonly [get: SignalReader<T>, set: SignalUpdater<T>] & {
    read: SignalReader<T>;
    update: SignalUpdater<T>;
  };

declare function signal<T>(initialValue: T | Immutable<T>, options?: SignalOptions): Signal<T>;

type SignalConstructor = <T>(
  initialValue: T | Immutable<T>,
  options?: SignalOptions,
) => Signal<T>;
```

## Full Behavior and Semantics

`signal(initialValue)` returns a tuple:

```ts
const [read, update] = signal(0);
```

- `read()` returns the current value as `Immutable<T>`
- `update(next)` sets the next value directly
- `update(fn)` computes the next value from the previous immutable snapshot

Signals are also array-like objects with convenience methods:

```ts
const count = signal(0);

count.read();
count.update(1);
count.update((prev) => prev + 1);
```

### Immutable reads

When a signal holds an object or array, the read side is intentionally typed as immutable:

```ts
const [todos, setTodos] = signal([{ title: 'Write docs', done: false }]);

const snapshot = todos();
// snapshot[0].done = true; // Type error

setTodos((previous) => {
    return previous.map((todo, index) => (index === 0 ? { ...todo, done: true } : todo));
});
```

This is a type-level guardrail, not a runtime freeze. The library prevents accidental mutation in TypeScript because mutating a previously read object would not trigger a signal update.

Reading a signal inside:

- a `memo()` makes the memo depend on that signal
- an `effect()` makes the effect depend on that signal
- `untracked()` does not create a dependency

Signals use equality to decide whether an update should notify dependents. By default, signals use structural equality, so writing a structurally equal value does not trigger a recomputation.

## Options and Related Types

### `SignalOptions`

```ts
interface SignalOptions {
    readonly equals?: (a: unknown, b: unknown) => boolean;
}
```

`equals` lets you override the comparison used to decide whether an update is meaningful.

Example: identity-only updates

```ts
const user = signal(
    { name: 'A' },
    {
        equals: Object.is,
    },
);
```

Example: custom shallow comparison

```ts
const point = signal(
    { x: 0, y: 0 },
    {
        equals(a, b) {
            return (
                !!a
                && !!b
                && typeof a === 'object'
                && typeof b === 'object'
                && (a as { x: number }).x === (b as { x: number }).x
                && (a as { y: number }).y === (b as { y: number }).y
            );
        },
    },
);
```

### `SignalReader<T>`

A signal, memo, or resource reader is a zero-argument function returning `Immutable<T>`.

```ts
const [count] = signal(0);
const read: SignalReader<number> = count;
```

### `SignalUpdater<T>`

The updater accepts either:

- a concrete value
- a function from the previous immutable snapshot to the next value

```ts
setCount(2);
setCount((prev) => prev + 1);
```

## Edge Cases and Gotchas

- Signal updates are synchronous.
- A signal can hold any value, including objects, arrays, functions, `null`, and `undefined`.
- Reads are immutable at the type level. If you want to change an object or array, write a new value instead of mutating the current read result.
- Structural equality avoids redundant updates, but if you need stricter or looser behavior, pass a custom `equals`.
- Signals created in one store must not be mixed with memos or effects from another store.

## Additional Examples

### Tuple style

```ts
const [name, setName] = signal('Ada');

setName('Grace');
console.log(name());
```

### Object-like style

```ts
const name = signal('Ada');

name.update('Grace');
console.log(name.read());
```

### Functional updates

```ts
const [count, setCount] = signal(0);

setCount((prev) => prev + 1);
setCount((prev) => prev + 1);
```

### Updating an object value

```ts
const [user, setUser] = signal({ name: 'Ada', admin: false });

setUser((user) => ({
    ...user,
    admin: true,
}));
```

## Related Topics

- [`memos.md`](./memos.md)
- [`effects.md`](./effects.md)
- [`utilities.md`](./utilities.md)
- [`store.md`](./store.md)
