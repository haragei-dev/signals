import { createStore, subscribe } from '@haragei/signals';
import type {
    AsyncEffectErrorInfo,
    AsyncEffectErrorOptions,
    ActionControls,
    ActionSubmitOptions,
    BatchFunction,
    Immutable,
    ResourceControls,
    SignalReader,
    Store,
} from '@haragei/signals';

export const REACT_READER = Symbol();

interface ReactReaderOwner<T> {
    getSnapshot(): Immutable<T>;
    subscribe(listener: () => void): () => void;
}

export type ReactSignalReader<T> = SignalReader<T> & {
    [REACT_READER]?: ReactReaderOwner<T>;
};

export interface ManagedReader<T> {
    readonly read: ReactSignalReader<T>;
    replace(nextSnapshot: Immutable<T>): void;
    publish(nextSnapshot: Immutable<T>): void;
    track(read: SignalReader<T> | undefined): void;
}

export function createManagedReader<T>(initialSnapshot: Immutable<T>): ManagedReader<T> {
    const listeners = new Set<() => void>();
    let snapshot = initialSnapshot;
    let trackedRead: SignalReader<T> | undefined;

    const read = (() => trackedRead?.() ?? snapshot) as ReactSignalReader<T>;
    read[REACT_READER] = {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void): () => void {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };

    return {
        read,
        replace(nextSnapshot: Immutable<T>): void {
            snapshot = nextSnapshot;
        },
        publish(nextSnapshot: Immutable<T>): void {
            if (Object.is(snapshot, nextSnapshot)) {
                return;
            }

            snapshot = nextSnapshot;

            for (const listener of listeners) {
                listener();
            }
        },
        track(nextRead: SignalReader<T> | undefined): void {
            trackedRead = nextRead;
        },
    };
}

export function getReactReaderOwner<T>(read: SignalReader<T>): ReactReaderOwner<T> | undefined {
    return (read as ReactSignalReader<T>)[REACT_READER];
}

export function createAbortError(): Error {
    const error = new Error();
    error.name = 'AbortError';
    return error;
}

export function createActionFallbackControls<Args extends readonly unknown[], T>(): ActionControls<
    Args,
    T
> {
    const reject = (): Promise<Immutable<T>> => Promise.reject(createAbortError());

    return {
        submit(): Promise<Immutable<T>> {
            return reject();
        },
        submitWith(options: ActionSubmitOptions, ...args: Args): Promise<Immutable<T>> {
            void options;
            void args;
            return reject();
        },
        abort(): void {},
        reset(): void {},
    };
}

export function createResourceFallbackControls(): Immutable<ResourceControls> {
    return {
        refresh(): void {},
        abort(): void {},
        reset(): void {},
    };
}

export function createStoreResolver(): () => Store {
    let clientStore: Store | undefined;

    return (): Store => {
        if (typeof window === 'undefined') {
            throw new Error(
                'SignalsProvider is required when creating signals during server rendering.',
            );
        }

        clientStore ??= createStore();
        return clientStore;
    };
}

export interface LinkedAbortController {
    readonly signal: AbortSignal;
    abort(): void;
}

export function createLinkedAbortController(signal?: AbortSignal): LinkedAbortController {
    const controller = new AbortController();

    if (signal?.aborted) {
        controller.abort();

        return {
            signal: controller.signal,
            abort(): void {},
        };
    }

    if (!signal) {
        return {
            signal: controller.signal,
            abort(): void {
                controller.abort();
            },
        };
    }

    const abort = (): void => {
        controller.abort();
    };

    signal.addEventListener('abort', abort, { once: true });

    return {
        signal: controller.signal,
        abort(): void {
            signal.removeEventListener('abort', abort);
            controller.abort();
        },
    };
}

export function createOnErrorOptions(
    onError: AsyncEffectErrorOptions | undefined,
    getHandler:
        | (() => ((error: unknown, info: AsyncEffectErrorInfo) => void) | undefined)
        | undefined,
): AsyncEffectErrorOptions | undefined {
    if (!onError) {
        return undefined;
    }

    const handler = getHandler
        ? (error: unknown, info: AsyncEffectErrorInfo): void => {
              getHandler()?.(error, info);
          }
        : undefined;

    return {
        ...(onError.mode ? { mode: onError.mode } : {}),
        ...(handler ? { handler } : {}),
    };
}

export function subscribeReader<T>(read: SignalReader<T>, listener: () => void): () => void {
    const owner = getReactReaderOwner(read);

    if (owner) {
        return owner.subscribe(listener);
    }

    return subscribe(read, listener);
}

export function readSnapshot<T>(read: SignalReader<T>): Immutable<T> {
    const owner = getReactReaderOwner(read);

    if (owner) {
        return owner.getSnapshot();
    }

    return read();
}

export function createBatchDelegate(store: Store): BatchFunction {
    return (execute: () => void): void => {
        store.batch(execute);
    };
}
