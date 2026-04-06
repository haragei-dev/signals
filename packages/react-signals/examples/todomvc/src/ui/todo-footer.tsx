import { useSignalValue } from '@haragei/react-signals';
import { useTodoState } from '../state/context';
import { useRenderCount } from './render-count';

export function TodoFooter() {
    useRenderCount('Footer');
    const state = useTodoState();
    const hasTodos = useSignalValue(state.hasTodos);
    const activeCount = useSignalValue(state.activeCount);
    const completedCount = useSignalValue(state.completedCount);
    const filter = useSignalValue(state.filter);

    return (
        <footer className="footer" hidden={!hasTodos}>
            <span className="todo-count">
                <strong>{activeCount}</strong> {activeCount === 1 ? 'item' : 'items'} left
            </span>
            <ul className="filters">
                <li>
                    <a href="#/" className={filter === 'all' ? 'selected' : ''}>
                        All
                    </a>
                </li>
                <li>
                    <a href="#/active" className={filter === 'active' ? 'selected' : ''}>
                        Active
                    </a>
                </li>
                <li>
                    <a href="#/completed" className={filter === 'completed' ? 'selected' : ''}>
                        Completed
                    </a>
                </li>
            </ul>
            <button
                className="clear-completed"
                hidden={completedCount === 0}
                onClick={() => {
                    state.clearCompleted();
                }}
            >
                Clear completed
            </button>
        </footer>
    );
}
