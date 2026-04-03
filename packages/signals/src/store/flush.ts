import type { StoreState } from './internal';

export function flushPendingEffects(state: StoreState): void {
    if (state._isUpdating) {
        return;
    }
    state._isUpdating = true;

    try {
        for (const fx of state._pendingEffects) {
            if (fx._isMemo) {
                fx._update();
                state._pendingEffects.delete(fx);
            }
        }
    } finally {
        state._isUpdating = false;
    }

    if (state._batchLevel > 0) {
        return;
    }

    const effects = Array.from(state._pendingEffects);
    state._pendingEffects.clear();

    for (const fx of effects) {
        fx._update();
    }
}
