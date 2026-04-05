import type {
    ActionConstructor,
    EffectConstructor,
    MemoConstructor,
    ResourceConstructor,
    SignalConstructor,
    UntrackedReader,
} from './store/types';
import { createStore } from './store/store';

/**
 * The global store.
 * @internal
 */
const globalStore = createStore();

/**
 * Creates a new signal.
 *
 * A signal is a reactive unit of state that can be read and updated.
 *
 * Returns a tuple of two functions:
 * - `read` - returns the current value of the signal.
 * - `update` - updates the value of the signal.
 *
 * @param initialValue The initial value of the signal.
 * @param options Optional parameters for customizing the behavior.
 * @returns A `[read, update]` tuple of accessor functions.
 */
export const signal: SignalConstructor = globalStore.signal;

/**
 * Reads the value of a signal without tracking it.
 *
 * @param read The signal reader function.
 */
export const untracked: UntrackedReader = globalStore.untracked;

/**
 * Creates and executes a new effect in the global store.
 *
 * An effect is a function which will be automatically
 * re-executed whenever any of its dependencies change.
 *
 * Returns a cleanup function that should be called when the effect is no longer needed.
 *
 * @param execute The function to execute.
 * @param options Optional parameters for customizing the behavior.
 * @returns A cleanup function.
 */
export const effect: EffectConstructor = globalStore.effect;

/**
 * Creates a new computed (and read-only) signal in the global store.
 *
 * A memo is a special signal that is only re-computed
 * when any of its dependencies change.
 *
 * Returns a getter function that returns the current value of the computation.
 *
 * @param compute The function to compute the value.
 * @param options Optional parameters for customizing the behavior.
 * @returns A getter function.
 */
export const memo: MemoConstructor = globalStore.memo;

/**
 * Creates a new imperative async action in the global store.
 *
 * An action is executed only when `submit()` or `submitWith()` is called.
 *
 * @param execute The async action executor function.
 * @param options Optional parameters for customizing concurrency and error handling.
 * @returns A state reader and action controls.
 */
export const action: ActionConstructor = globalStore.action;

/**
 * Creates a new async resource in the global store.
 *
 * A resource manages async loading state, stale values, and errors.
 *
 * @param load The async loader function.
 * @param options Optional parameters for customizing scheduling and writes.
 * @returns A state reader and resource controls.
 */
export const resource: ResourceConstructor = globalStore.resource;

/**
 * Executes a batch of updates within the global store.
 *
 * The batch function allows you to execute multiple updates while
 * ensuring that the signals are only updated once at the end of the batch.
 *
 * @param execute The function to execute.
 */
export const batch = globalStore.batch;
