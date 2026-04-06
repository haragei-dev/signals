import { createEffect } from './store/effect';
import { getReaderOwner } from './store/signal';
import type { SignalReader, SubscribeFunction } from './store/types';

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
    const state = getReaderOwner(read);

    if (!state) {
        throw new Error('Can only subscribe to readers created by @haragei/signals.');
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
