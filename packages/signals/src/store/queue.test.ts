import { describe, expect, it } from 'vitest';
import { DefaultInvalidationQueue } from './queue';

describe('DefaultInvalidationQueue', () => {
    it('Provides an array-backed FIFO queue.', () => {
        const queue = new DefaultInvalidationQueue<number>();

        expect(queue.size).toBe(0);

        queue.enqueue(1);
        queue.enqueue(2);

        expect(queue.size).toBe(2);
        expect(queue.dequeue()).toBe(1);
        expect(queue.dequeue()).toBe(2);
        expect(queue.dequeue()).toBeUndefined();
        expect(queue.size).toBe(0);
    });

    it('Clears queued items.', () => {
        const queue = new DefaultInvalidationQueue<number>();

        queue.enqueue(1);
        queue.enqueue(2);
        queue.clear();

        expect(queue.size).toBe(0);
        expect(queue.dequeue()).toBeUndefined();
    });
});
