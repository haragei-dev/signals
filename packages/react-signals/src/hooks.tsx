import { useEffect, useRef, useSyncExternalStore } from 'react';
import type {
    ActionContext,
    ActionControls,
    ActionOptions,
    ActionState,
    AsyncEffectErrorOptions,
    AsyncEffectFunction,
    AsyncEffectOptions,
    BatchFunction,
    EffectFunction,
    EffectOptions,
    Immutable,
    ResourceControls,
    ResourceContext,
    ResourceOptions,
    ResourceState,
    Signal,
    SignalOptions,
    SignalReader,
} from '@haragei/signals';
import {
    createActionFallbackControls,
    createBatchDelegate,
    createLinkedAbortController,
    createManagedReader,
    createOnErrorOptions,
    createResourceFallbackControls,
    readSnapshot,
    subscribeReader,
} from './internal';
import { useSignalStore } from './context';

function useLatestRef<T>(value: T): { current: T } {
    const ref = useRef(value);
    ref.current = value;
    return ref;
}

function useManagedReader<T>(initialSnapshot: Immutable<T>) {
    const ref = useRef<ReturnType<typeof createManagedReader<T>> | undefined>(undefined);

    if (!ref.current) {
        ref.current = createManagedReader(initialSnapshot);
    }

    return ref.current;
}

function useStableActionControls<Args extends readonly unknown[], T>(
    fallback: ActionControls<Args, T>,
): {
    currentRef: { current: ActionControls<Args, T> };
    controls: ActionControls<Args, T>;
} {
    const controlsRef = useRef<ActionControls<Args, T>>(fallback);
    const wrapperRef = useRef<ActionControls<Args, T> | undefined>(undefined);

    if (!wrapperRef.current) {
        wrapperRef.current = {
            submit(...args: Args): Promise<Immutable<T>> {
                return controlsRef.current.submit(...args);
            },
            submitWith(options, ...args: Args): Promise<Immutable<T>> {
                return controlsRef.current.submitWith(options, ...args);
            },
            abort(): void {
                controlsRef.current.abort();
            },
            reset(): void {
                controlsRef.current.reset();
            },
        };
    }

    return {
        currentRef: controlsRef,
        controls: wrapperRef.current,
    };
}

function useStableResourceControls(fallback: Immutable<ResourceControls>): {
    readonly controls: Immutable<ResourceControls>;
    readonly currentRef: { current: ResourceControls };
} {
    const currentRef = useRef<ResourceControls>(fallback);
    const wrapperRef = useRef<ResourceControls | undefined>(undefined);

    if (!wrapperRef.current) {
        wrapperRef.current = {
            refresh(): void {
                currentRef.current.refresh();
            },
            abort(): void {
                currentRef.current.abort();
            },
            reset(): void {
                currentRef.current.reset();
            },
        };
    }

    return {
        currentRef,
        controls: wrapperRef.current,
    };
}

function isAsyncEffectOptions(
    options: EffectOptions | AsyncEffectOptions | undefined,
): options is AsyncEffectOptions {
    return !!options && ('concurrency' in options || 'queue' in options || 'onError' in options);
}

function createMemoOptions(
    signal: AbortSignal,
    equals: SignalOptions['equals'] | undefined,
): SignalOptions & EffectOptions {
    return equals ? { signal, equals } : { signal };
}

function createEffectOptions(
    signal: AbortSignal,
    options: EffectOptions | AsyncEffectOptions | undefined,
    onError: AsyncEffectErrorOptions | undefined,
): EffectOptions | AsyncEffectOptions {
    if (!isAsyncEffectOptions(options)) {
        return { signal };
    }

    return onError
        ? {
              signal,
              concurrency: options.concurrency,
              queue: options.queue,
              onError,
          }
        : {
              signal,
              concurrency: options.concurrency,
              queue: options.queue,
          };
}

function createResourceOptions(
    signal: AbortSignal,
    options: ResourceOptions | undefined,
    onError: AsyncEffectErrorOptions | undefined,
): ResourceOptions {
    return {
        signal,
        ...(options?.concurrency ? { concurrency: options.concurrency } : {}),
        ...(options?.queue ? { queue: options.queue } : {}),
        ...(options?.writes ? { writes: options.writes } : {}),
        ...(onError ? { onError } : {}),
    };
}

function createActionOptions(
    signal: AbortSignal,
    options: ActionOptions | undefined,
    onError: AsyncEffectErrorOptions | undefined,
): ActionOptions {
    return {
        signal,
        ...(options?.concurrency ? { concurrency: options.concurrency } : {}),
        ...(options?.queue ? { queue: options.queue } : {}),
        ...(onError ? { onError } : {}),
    };
}

export function useSignalValue<T>(read: SignalReader<T>): Immutable<T> {
    return useSyncExternalStore(
        (listener) => subscribeReader(read, listener),
        () => readSnapshot(read),
        () => readSnapshot(read),
    );
}

export function useSignal<T>(initialValue: T | Immutable<T>, options?: SignalOptions): Signal<T> {
    const store = useSignalStore();
    const ref = useRef<{ store: ReturnType<typeof useSignalStore>; signal: Signal<T> } | undefined>(
        undefined,
    );

    if (!ref.current || ref.current.store !== store) {
        ref.current = {
            store,
            signal: store.signal(initialValue, options),
        };
    }

    useSignalValue(ref.current.signal.read);

    return ref.current.signal;
}

export function useSignalMemo<T>(
    compute: () => T,
    options?: SignalOptions & EffectOptions,
): SignalReader<T> {
    const store = useSignalStore();
    const computeRef = useLatestRef(compute);
    const initialSnapshot = compute() as Immutable<T>;
    const managed = useManagedReader<T>(initialSnapshot);

    managed.replace(initialSnapshot);

    useEffect(() => {
        const lifetime = createLinkedAbortController(options?.signal);
        const read = store.memo(
            () => computeRef.current(),
            createMemoOptions(lifetime.signal, options?.equals),
        );
        const sync = (): void => {
            managed.publish(read());
        };

        managed.track(read);
        sync();

        const unsubscribe = subscribeReader(read, sync);

        return () => {
            unsubscribe();
            managed.track(undefined);
            lifetime.abort();
        };
    }, [computeRef, managed, options?.equals, options?.signal, store]);

    return managed.read;
}

export function useSignalEffect(execute: EffectFunction, options?: EffectOptions): void;
export function useSignalEffect(execute: AsyncEffectFunction, options?: AsyncEffectOptions): void;
export function useSignalEffect(
    execute: EffectFunction | AsyncEffectFunction,
    options?: EffectOptions | AsyncEffectOptions,
): void {
    const store = useSignalStore();
    const executeRef = useLatestRef(execute);
    const asyncOptions = isAsyncEffectOptions(options) ? options : undefined;
    const onErrorHandlerRef = useLatestRef(asyncOptions?.onError?.handler);

    useEffect(() => {
        const lifetime = createLinkedAbortController(options?.signal);
        const cleanup = store.effect(
            ((context) => executeRef.current(context as never)) as EffectFunction
                & AsyncEffectFunction,
            createEffectOptions(
                lifetime.signal,
                options,
                createOnErrorOptions(asyncOptions?.onError, () => onErrorHandlerRef.current),
            ),
        );

        return () => {
            cleanup();
            lifetime.abort();
        };
    }, [
        asyncOptions?.concurrency,
        asyncOptions?.queue,
        asyncOptions?.onError?.mode,
        onErrorHandlerRef,
        options?.signal,
        store,
    ]);
}

export function useSignalResource<T, E = unknown>(
    load: (context: ResourceContext<T, E>) => Promise<Immutable<T>>,
    options?: ResourceOptions,
): readonly [SignalReader<ResourceState<T, E>>, Immutable<ResourceControls>] {
    const store = useSignalStore();
    const loadRef = useLatestRef(load);
    const onErrorHandlerRef = useLatestRef(options?.onError?.handler);
    const managed = useManagedReader<ResourceState<T, E>>({
        status: 'idle',
        value: undefined,
        error: undefined,
        isStale: false,
    });
    const resourceControls = useStableResourceControls(createResourceFallbackControls());

    useEffect(() => {
        const lifetime = createLinkedAbortController(options?.signal);
        const [read, controls] = store.resource<T, E>(
            (context) => loadRef.current(context),
            createResourceOptions(
                lifetime.signal,
                options,
                createOnErrorOptions(options?.onError, () => onErrorHandlerRef.current),
            ),
        );
        const sync = (): void => {
            managed.publish(read());
        };

        managed.track(read);
        resourceControls.currentRef.current = controls;
        sync();

        const unsubscribe = subscribeReader(read, sync);

        return () => {
            unsubscribe();
            managed.track(undefined);
            resourceControls.currentRef.current = createResourceFallbackControls();
            lifetime.abort();
        };
    }, [
        loadRef,
        managed,
        onErrorHandlerRef,
        options?.concurrency,
        options?.onError?.mode,
        options?.queue,
        options?.signal,
        options?.writes,
        resourceControls.currentRef,
        store,
    ]);

    return [managed.read, resourceControls.controls] as const;
}

export function useSignalAction<T, Args extends readonly unknown[] = [], E = unknown>(
    execute: (context: ActionContext<T, E>, ...args: Args) => Promise<Immutable<T>>,
    options?: ActionOptions,
): readonly [SignalReader<ActionState<T, E>>, ActionControls<Args, T>] {
    const store = useSignalStore();
    const executeRef = useLatestRef(execute);
    const onErrorHandlerRef = useLatestRef(options?.onError?.handler);
    const managed = useManagedReader<ActionState<T, E>>({
        status: 'idle',
        value: undefined,
        error: undefined,
        isStale: false,
    });
    const actionControls = useStableActionControls<Args, T>(createActionFallbackControls());

    useEffect(() => {
        const lifetime = createLinkedAbortController(options?.signal);
        const [read, controls] = store.action<T, Args, E>(
            (context, ...args) => executeRef.current(context, ...args),
            createActionOptions(
                lifetime.signal,
                options,
                createOnErrorOptions(options?.onError, () => onErrorHandlerRef.current),
            ),
        );
        const sync = (): void => {
            managed.publish(read());
        };

        managed.track(read);
        actionControls.currentRef.current = controls;
        sync();

        const unsubscribe = subscribeReader(read, sync);

        return () => {
            unsubscribe();
            managed.track(undefined);
            actionControls.currentRef.current = createActionFallbackControls<Args, T>();
            lifetime.abort();
        };
    }, [
        actionControls.currentRef,
        executeRef,
        managed,
        onErrorHandlerRef,
        options?.concurrency,
        options?.onError?.mode,
        options?.queue,
        options?.signal,
        store,
    ]);

    return [managed.read, actionControls.controls] as const;
}

export function useSignalBatch(): BatchFunction {
    const store = useSignalStore();
    const ref = useRef<
        { store: ReturnType<typeof useSignalStore>; batch: BatchFunction } | undefined
    >(undefined);

    if (!ref.current || ref.current.store !== store) {
        ref.current = {
            store,
            batch: createBatchDelegate(store),
        };
    }

    return ref.current.batch;
}
