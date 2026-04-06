import { createEffect } from './store/effect';
import type { LifecycleOwner, StoreState } from './store/internal';
import { READER_LIFETIME_OWNER, READER_OWNER } from './store/signal';
import type { SignalReader, SubscribeFunction } from './store/types';

type OwnedReader<T> = SignalReader<T> & {
    [READER_OWNER]?: StoreState;
    [READER_LIFETIME_OWNER]?: LifecycleOwner;
};

/**
 * Subscribes a listener to changes of a reader created by this library.
 *
 * This is primarily intended for external adapter integrations.
 *
 * @param read The reader to subscribe to.
 * @param listener The listener to invoke after the reader changes.
 * @returns An unsubscribe function.
 */
export const subscribe: SubscribeFunction = <T>(
    read: SignalReader<T>,
    listener: () => void,
): (() => void) => {
    const state = (read as OwnedReader<T>)[READER_OWNER];
    const owner = (read as OwnedReader<T>)[READER_LIFETIME_OWNER];

    if (!state || !owner) {
        throw new Error('Needs @haragei/signals reader.');
    }

    let initialized = false;

    return createEffect(state, owner, () => {
        read();

        if (initialized) {
            listener();
            return;
        }

        initialized = true;
    });
};
