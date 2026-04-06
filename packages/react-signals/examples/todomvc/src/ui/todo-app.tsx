import { useEffect, useMemo } from 'react';
import { SignalsProvider, useSignalScope } from '@haragei/react-signals';
import { TodoStateProvider } from '../state/context';
import { createTodoState } from '../state/todos';
import { useRenderCount } from './render-count';
import { TodoHeader } from './todo-header';
import { TodoMain } from './todo-main';
import { TodoFooter } from './todo-footer';

export function TodoMvcExample() {
    useRenderCount('Root');
    const scope = useSignalScope();
    const state = useMemo(() => createTodoState(scope), [scope]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        window.addEventListener('hashchange', state.handleHashChange);

        return () => {
            window.removeEventListener('hashchange', state.handleHashChange);
        };
    }, [state]);

    return (
        <SignalsProvider store={scope}>
            <TodoStateProvider state={state}>
                <TodoMvcApp />
            </TodoStateProvider>
        </SignalsProvider>
    );
}

function TodoMvcApp() {
    useRenderCount('App');

    return (
        <>
            <section className="todoapp">
                <TodoHeader />
                <TodoMain />
                <TodoFooter />
            </section>
            <footer className="info">
                <p>Double-click to edit a todo</p>
                <p>
                    Example using the <code>@haragei/react-signals</code> adapter.
                </p>
            </footer>
        </>
    );
}
