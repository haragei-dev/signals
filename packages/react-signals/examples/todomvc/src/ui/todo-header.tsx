import { useTodoState } from '../state/context';
import { useRenderCount } from './render-count';

const ENTER_KEY = 'Enter';

export function TodoHeader() {
    useRenderCount('Header');
    const state = useTodoState();

    return (
        <header className="header">
            <h1>todos</h1>
            <input
                autoFocus
                className="new-todo"
                placeholder="What needs to be done?"
                autoComplete="off"
                onKeyDown={(event) => {
                    if (event.key !== ENTER_KEY) {
                        return;
                    }

                    if (state.addTodo(event.currentTarget.value)) {
                        event.currentTarget.value = '';
                    }
                }}
            />
        </header>
    );
}
