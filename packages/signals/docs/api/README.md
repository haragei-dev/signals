# API Reference

This directory contains the full handwritten API reference for `@haragei/signals`.

Across the API, reactive reads return `Immutable<T>` snapshots at the type level. This applies to signals, memos, `untracked()`, `track()`, and resource or action state reads.

Use these pages as focused reference documents:

- [`signals.md`](./signals.md)
  Reactive values, immutable reads, tuple ergonomics, and `SignalOptions`.
- [`memos.md`](./memos.md)
  Derived state, memo invalidation, and equality behavior.
- [`effects.md`](./effects.md)
  Sync and async effects, `EffectContext`, `track()`, concurrency, queues, and async error handling.
- [`actions.md`](./actions.md)
  Imperative async writes, `ActionState`, `submit()`, and action concurrency controls.
- [`resources.md`](./resources.md)
  Async derived state, `ResourceState`, `RunCause`, write guards, and resource controls.
- [`store.md`](./store.md)
  `createStore()`, store isolation, store-local APIs, and `unlink()`.
- [`utilities.md`](./utilities.md)
  Shared runtime utilities such as `batch()`, `untracked()`, and invalidation queues.
