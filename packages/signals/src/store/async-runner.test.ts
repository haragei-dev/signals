import { describe, expect, it } from 'vitest';
import { createAsyncRunner } from './async-runner';
import { ABORT_CONTROL, CANCELED, FULFILLED } from './internal';
import type { EffectInstance } from './internal';
import { createSignal } from './signal';
import {
    createTestOwner,
    createTestState,
    deferred,
    flushPromises,
} from '../test/store-test-helpers';

describe('createAsyncRunner()', () => {
    it('Ignores cancelActive() after the runner has already been stopped.', () => {
        const state = createTestState();
        const owner = createTestOwner(state);
        const effect: EffectInstance = {
            _isMemo: false,
            _update() {},
            _cancel() {},
        };

        const control = createAsyncRunner(
            state,
            owner,
            effect,
            {},
            {
                _prepare() {},
                _execute() {},
                _commit() {},
            },
        );

        control._stop();
        control._cancelActive();

        expect(state._activeEffects.size).toBe(0);
        expect(state._pendingEffects.size).toBe(0);
    });

    it('Keeps sync subscriptions when prepared state is undefined.', () => {
        const state = createTestState();
        const owner = createTestOwner(state);
        const effect: EffectInstance = {
            _isMemo: false,
            _update() {
                control._invalidate();
            },
            _cancel() {
                control._stop();
            },
        };
        const [read, write] = createSignal(state, owner, 0);
        const runs: number[] = [];

        const control = createAsyncRunner(
            state,
            owner,
            effect,
            {},
            {
                _prepare() {
                    return undefined;
                },
                _execute() {
                    runs.push(read());
                },
                _commit() {},
                _shouldCommit(run, _completion, _prepared, info) {
                    return run._generation === info._latestStartedGeneration;
                },
            },
        );

        control._invalidate();

        state._batchLevel = 1;
        write(1);

        expect(runs).toEqual([0]);
        expect(state._pendingEffects.size).toBe(1);
    });

    it('Stops the runner on rejected async work when cancel error handling has no custom cancel hook.', async () => {
        const state = createTestState();
        const owner = createTestOwner(state);
        const effect: EffectInstance = {
            _isMemo: false,
            _update() {
                control._invalidate();
            },
            _cancel() {
                control._stop();
            },
        };

        const control = createAsyncRunner(
            state,
            owner,
            effect,
            { _onError: { mode: 'cancel' } },
            {
                _prepare() {
                    return undefined;
                },
                _execute() {
                    return Promise.reject(new Error('boom'));
                },
                _commit() {},
            },
        );

        control._invalidate();
        await flushPromises();

        expect(state._activeEffects.size).toBe(0);
        expect(state._pendingEffects.size).toBe(0);
    });

    it('Falls back to committing async results when no shouldCommit hook is provided.', async () => {
        const state = createTestState();
        const owner = createTestOwner(state);
        const effect: EffectInstance = {
            _isMemo: false,
            _update() {
                control._invalidate();
            },
            _cancel() {
                control._stop();
            },
        };
        const commits: number[] = [];

        const control = createAsyncRunner(
            state,
            owner,
            effect,
            {},
            {
                _prepare() {
                    return undefined;
                },
                _execute() {
                    return Promise.resolve(1);
                },
                _commit(_run, completion) {
                    if (completion._status === FULFILLED) {
                        commits.push(completion._value);
                    }
                },
            },
        );

        control._invalidate();
        await flushPromises();

        expect(commits).toEqual([1]);
    });

    it('Unwinds tracking state when execute throws synchronously during runner startup.', () => {
        const state = createTestState();
        const owner = createTestOwner(state);
        const effect: EffectInstance = {
            _isMemo: false,
            _update() {
                control._invalidate();
            },
            _cancel() {
                control._stop();
            },
        };

        const control = createAsyncRunner(
            state,
            owner,
            effect,
            {},
            {
                _prepare() {
                    return undefined;
                },
                _execute() {
                    throw new Error('boom');
                },
                _commit() {},
            },
        );

        expect(() => {
            control._invalidate();
        }).toThrow('boom');
        expect(state._runs).toEqual([]);
        expect(state._isTracking).toBe(false);
        expect(state._activeEffects.size).toBe(0);
    });

    it('Unwinds untracked runner state when execute throws synchronously during startup.', () => {
        const state = createTestState();
        const owner = createTestOwner(state);
        const effect: EffectInstance = {
            _isMemo: false,
            _update() {
                control._invalidate();
            },
            _cancel() {
                control._stop();
            },
        };

        const control = createAsyncRunner(
            state,
            owner,
            effect,
            { _trackDependencies: false },
            {
                _prepare() {
                    return undefined;
                },
                _execute() {
                    throw new Error('boom');
                },
                _commit() {},
            },
        );

        expect(() => {
            control._invalidate();
        }).toThrow('boom');
        expect(state._runs).toEqual([]);
        expect(state._isTracking).toBe(false);
        expect(state._activeEffects.size).toBe(0);
    });

    it('Preserves dependencies idempotently when active work is canceled repeatedly.', async () => {
        const state = createTestState();
        const owner = createTestOwner(state);
        const [read] = createSignal(state, owner, 0);
        const pending = deferred<void>();
        const effect: EffectInstance = {
            _isMemo: false,
            _update() {
                control._invalidate();
            },
            _cancel() {
                control._stop();
            },
        };

        const control = createAsyncRunner(
            state,
            owner,
            effect,
            {},
            {
                _prepare() {
                    return undefined;
                },
                _execute(context) {
                    read();
                    return pending.promise.then(() => {
                        context._onCleanup(() => {});
                    });
                },
                _commit() {},
                _abortRun(run, _prepared, kind, helpers) {
                    if (kind !== ABORT_CONTROL) {
                        return false;
                    }

                    run._isTracking = false;
                    run._controller.abort();
                    run._state = CANCELED;
                    helpers._preserveRunDependencies(run);
                    helpers._preserveRunDependencies(run);
                    helpers._cleanupRun(run);
                    return true;
                },
            },
        );

        control._invalidate();
        control._cancelActive();
        control._cancelActive();
        pending.resolve();
        await flushPromises();

        expect(state._activeEffects.size).toBe(1);
    });
});
