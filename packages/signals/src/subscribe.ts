import { createEffect } from './store/effect';
import type { StoreState } from './store/internal';
import { READER_OWNER } from './store/signal';
import type { SignalReader, SubscribeFunction } from './store/types';

type OwnedReader<T> = SignalReader<T> & {
    [READER_OWNER]?: StoreState;
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

    if (!state) {
        throw new Error('Needs @haragei/signals reader.');
    }

    let initialized = false;

    return createEffect(state, () => {
        read();

        if (initialized) {
            listener();
            return;
        }

        initialized = true;
    });
};
