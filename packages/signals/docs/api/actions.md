# Actions

## Overview

Actions are imperative asynchronous write operations. They complement [`resource()`](./resources.md): where resources model async reads that react to dependencies, actions model async writes that run only when explicitly submitted.

An action never auto-runs and never tracks signal, memo, or resource reads inside its executor.

This page covers `action()`, `ActionStatus`, `ActionState`, `ActionContext`, `ActionControls`, `ActionSubmitOptions`, `ActionOptions`, and `ActionConstructor`.

## Canonical Example

```ts
import { action, effect, signal } from '@haragei/signals';

const name = signal('');

const [saveProfile, { submit }] = action(async ({ signal }, nextName: string) => {
    const response = await fetch('/api/profile', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
    });

    return response.json() as Promise<{ saved: boolean; name: string }>;
});

effect(() => {
    const state = saveProfile();

    if (state.status === 'pending') {
        console.log('Saving...');
    }

    if (state.status === 'success') {
        console.log('Saved profile for', state.value.name);
    }
});

void submit(name());
```

## Public API Summary

```ts
type ActionStatus = 'idle' | 'pending' | 'success' | 'error';

type ActionState<T, E = unknown> =
    | { status: 'idle'; value: undefined; error: undefined; isStale: false }
    | { status: 'pending'; value: undefined; error: undefined; isStale: false }
    | { status: 'pending'; value: T; error: undefined; isStale: true }
    | { status: 'success'; value: T; error: undefined; isStale: false }
    | { status: 'error'; value: T | undefined; error: E; isStale: boolean };

interface ActionContext<T, E = unknown> {
    readonly signal: AbortSignal;
    onCleanup(cleanup: () => void): void;
    readonly previous: Immutable<ActionState<T, E>>;
}

interface ActionSubmitOptions {
    readonly signal?: AbortSignal;
}

interface ActionControls<Args extends readonly unknown[], T> {
    submit(...args: Args): Promise<Immutable<T>>;
    submitWith(options: ActionSubmitOptions, ...args: Args): Promise<Immutable<T>>;
    abort(): void;
    reset(): void;
}

interface ActionOptions {
    readonly signal?: AbortSignal;
    readonly concurrency?: 'cancel' | 'concurrent' | 'queue';
    readonly queue?: InvalidationQueue;
    readonly onError?: AsyncEffectErrorOptions;
}

declare function action<T, Args extends readonly unknown[] = [], E = unknown>(
    execute: (context: ActionContext<T, E>, ...args: Args) => Promise<Immutable<T>>,
    options?: ActionOptions,
): readonly [read: SignalReader<ActionState<T, E>>, controls: ActionControls<Args, T>];
```

## Full Behavior and Semantics

Actions start in `idle` and do nothing until `submit()` is called.

```ts
const [save, controls] = action(async (_context, id: string) => {
    return { ok: true, id };
});

await controls.submit('user-1');
```

Each `submit()` call:

- starts one action run
- returns a promise for that run's result
- updates the shared visible `ActionState`

`submitWith()` does the same thing, but lets you attach a submit-scoped `AbortSignal` without affecting other submits of the same action.

`ActionOptions.signal` is different: it controls the lifetime of the action instance itself.

Unlike `resource()`, action executors are never reactive:

- reads before the first `await` are untracked
- reads after the first `await` are also untracked
- `track()` is intentionally unavailable

This makes actions suitable for writes such as form submission, mutation, and command-style async workflows.

## State Transitions

### `idle`

No action has been submitted yet, or the action was reset.

```ts
{ status: 'idle', value: undefined, error: undefined, isStale: false }
```

### `pending`

The action currently has an in-flight submit.

Without previous value:

```ts
{ status: 'pending', value: undefined, error: undefined, isStale: false }
```

With previous successful value retained:

```ts
{ status: 'pending', value: previousValue, error: undefined, isStale: true }
```

### `success`

The latest accepted submit resolved successfully.

```ts
{ status: 'success', value, error: undefined, isStale: false }
```

### `error`

The latest accepted submit rejected or threw.

```ts
{ status: 'error', value: previousValueOrUndefined, error, isStale: boolean }
```

## Options and Related Types

### `ActionContext`

`ActionContext` is passed to every action executor.

It exposes:

- `signal`
- `onCleanup()`
- `previous`

It intentionally does not expose:

- `track()`
- `cancel()`
- `refresh()`
- `abort()`
- `reset()`

#### `signal`

Abort signal for the current submit.

```ts
action(async ({ signal }, formData: FormData) => {
    await fetch('/api/forms', { method: 'POST', body: formData, signal });
    return { ok: true };
});
```

This is the current run signal, not the action instance lifetime signal from `ActionOptions.signal`.

#### `onCleanup(cleanup)`

Registers cleanup for the current submit.

```ts
action(async ({ onCleanup }) => {
    const timer = setTimeout(() => {}, 1000);
    onCleanup(() => clearTimeout(timer));
    return true;
});
```

#### `previous`

The previous visible `ActionState`, typed as `Immutable<ActionState<T, E>>`.

```ts
action(async ({ previous }) => {
    if (previous.status === 'error') {
        console.log('Retrying after error:', previous.error);
    }

    return true;
});
```

### `ActionControls`

#### `submit(...args)`

Runs the action imperatively and returns a promise for that submit's result.

```ts
const [, { submit }] = action(async (_context, id: string) => {
    return { saved: true, id };
});

const result = await submit('user-1');
```

#### `submitWith(options, ...args)`

Runs the action imperatively with submit-scoped options.

The only supported submit option is `signal`.

```ts
const controller = new AbortController();

const [, { submitWith }] = action(async ({ signal }, id: string) => {
    await fetch(`/api/users/${id}`, { method: 'POST', signal });
    return { saved: true, id };
});

const result = await submitWith({ signal: controller.signal }, 'user-1');
```

#### `abort()`

Aborts the active submit and clears queued submits, then restores the last settled visible state.

If the action has never settled before, `abort()` returns the visible state to `idle`.

```ts
const [, controls] = action(async ({ signal }) => {
    await fetch('/api/save', { method: 'POST', signal });
    return true;
});

controls.abort();
```

#### `reset()`

Aborts active work, clears queued submits, and returns the visible action state to `idle`.

### `ActionOptions`

#### `signal`

Optional lifetime signal for the action instance itself.

```ts
const controller = new AbortController();

const [save, controls] = action(
    async ({ signal }, id: string) => {
        await fetch(`/api/users/${id}`, { method: 'POST', signal });
        return { saved: true, id };
    },
    { signal: controller.signal },
);
```

If this signal is already aborted when the action is created:

- the action stays `idle`
- no submits can start
- future `submit()` and `submitWith()` calls reject with `AbortError`

If it aborts later:

- active work is aborted
- queued submits are cleared
- the visible state restores to the last settled state
- future submits reject with `AbortError`

#### `concurrency`

Controls what happens when `submit()` is called while a previous run is still pending.

##### `'cancel'` (default)

Abort the stale submit and keep only the latest pending rerun.

##### `'concurrent'`

Allow overlapping submits. Shared visible state still reflects the latest started submit.

##### `'queue'`

Queue submits and execute them in order.

### `onError`

Uses the same `AsyncEffectErrorOptions` shape as async effects and resources.

Submit promises still reject with the underlying error even when `onError` is configured.

## Edge Cases and Gotchas

- Action execution is always imperative. Reading signals inside an action never creates subscriptions.
- Action state reads are immutable at the type level.
- Shared visible action state always follows latest-submit-wins semantics.
- Individual `submit()` and `submitWith()` promises still resolve or reject independently, even when their run does not win the visible state.
- `abort()` restores the last settled visible state; `reset()` returns it to `idle`.
- Canceled or cleared submits reject with `AbortError`.
- `ActionOptions.signal` controls the action instance lifetime; `ActionContext.signal` and `ActionSubmitOptions.signal` are scoped to individual runs.

## Additional Examples

### Form submission with retained success state

```ts
const [save, controls] = action(async (_context, values: { name: string }) => {
    return { saved: true, values };
});

void controls.submit({ name: 'Ada' });

if (save().status === 'pending' && save().isStale) {
    console.log('Resubmitting while showing the last saved result.');
}
```

### Queueing writes

```ts
const [upload, controls] = action(
    async (_context, file: File) => {
        return await sendFile(file);
    },
    { concurrency: 'queue' },
);

void controls.submit(fileA);
void controls.submit(fileB);
```

### Submit-scoped cancellation

```ts
const controller = new AbortController();

const [save, controls] = action(async ({ signal }, values: { name: string }) => {
    await fetch('/api/profile', {
        method: 'POST',
        signal,
        body: JSON.stringify(values),
    });

    return { saved: true };
});

void controls.submitWith({ signal: controller.signal }, { name: 'Ada' });

controller.abort();
```

## Related Topics

- [`resources.md`](./resources.md)
- [`effects.md`](./effects.md)
- [`store.md`](./store.md)
