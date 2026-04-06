import { useSignalValue } from '@haragei/react-signals';
import { useTodoState } from '../state/context';
import { useRenderCount } from './render-count';
import { TodoItem } from './todo-item';

export function TodoMain() {
    useRenderCount('Main');
    const state = useTodoState();
    const hasTodos = useSignalValue(state.hasTodos);
    const allCompleted = useSignalValue(state.allCompleted);
    const visibleTodos = useSignalValue(state.visibleTodos);
    const editingId = useSignalValue(state.editingId);

    return (
        <section className="main" hidden={!hasTodos}>
            <input
                id="toggle-all"
                className="toggle-all"
                type="checkbox"
                checked={allCompleted}
                onChange={(event) => {
                    state.toggleAll(event.currentTarget.checked);
                }}
            />
            <label htmlFor="toggle-all">Mark all as complete</label>
            <ul className="todo-list">
                {visibleTodos.map((todo) => (
                    <TodoItem key={todo.id} todo={todo} isEditing={editingId === todo.id} />
                ))}
            </ul>
        </section>
    );
}
