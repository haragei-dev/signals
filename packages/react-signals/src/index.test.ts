import { expectTypeOf, test } from 'vitest';
import type {
    ActionControls,
    ActionState,
    BatchFunction,
    ResourceControls,
    ResourceState,
    Signal,
    SignalReader,
    Store,
} from '@haragei/signals';
import {
    SignalsProvider,
    useSignal,
    useSignalAction,
    useSignalBatch,
    useSignalEffect,
    useSignalMemo,
    useSignalResource,
    useSignalScope,
    useSignalStore,
    useSignalValue,
} from './index';

test('exports the React hook surface with the expected types.', () => {
    expectTypeOf(SignalsProvider).toBeFunction();
    expectTypeOf(useSignalStore).returns.toEqualTypeOf<Store>();
    expectTypeOf(useSignal).returns.toEqualTypeOf<Signal<unknown>>();
    expectTypeOf(useSignalValue).returns.toEqualTypeOf<unknown>();
    expectTypeOf(useSignalMemo).returns.toEqualTypeOf<SignalReader<unknown>>();
    expectTypeOf(useSignalEffect).toBeFunction();
    expectTypeOf(useSignalBatch).returns.toEqualTypeOf<BatchFunction>();
    expectTypeOf(useSignalScope).returns.toEqualTypeOf<Store>();
    expectTypeOf(useSignalResource).returns.toEqualTypeOf<
        readonly [SignalReader<ResourceState<unknown, unknown>>, Readonly<ResourceControls>]
    >();
    expectTypeOf(useSignalAction).returns.toEqualTypeOf<
        readonly [
            SignalReader<ActionState<unknown, unknown>>,
            ActionControls<readonly unknown[], unknown>,
        ]
    >();
});
