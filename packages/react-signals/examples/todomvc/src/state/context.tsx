import { createContext, useContext, type PropsWithChildren } from 'react';
import type { TodoAppState } from './todos';

const TodoStateContext = createContext<TodoAppState | null>(null);

export function TodoStateProvider({
    state,
    children,
}: PropsWithChildren<{ readonly state: TodoAppState }>) {
    return <TodoStateContext.Provider value={state}>{children}</TodoStateContext.Provider>;
}

export function useTodoState(): TodoAppState {
    const state = useContext(TodoStateContext);

    if (!state) {
        throw new Error('useTodoState must be used within a TodoStateProvider');
    }

    return state;
}
