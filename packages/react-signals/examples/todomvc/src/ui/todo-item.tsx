import { memo, useEffect, useRef } from 'react';
import type { Todo } from '../state/todos';
import { useTodoState } from '../state/context';
import { useRenderCount } from './render-count';

const ENTER_KEY = 'Enter';
const ESCAPE_KEY = 'Escape';

export const TodoItem = memo(function TodoItem({
    todo,
    isEditing,
}: {
    readonly todo: Todo;
    readonly isEditing: boolean;
}) {
    useRenderCount('TodoItem');
    const state = useTodoState();
    const editInputRef = useRef<HTMLInputElement | null>(null);
    const cancelledRef = useRef(false);

    useEffect(() => {
        if (!isEditing) {
            cancelledRef.current = false;
            return;
        }

        const input = editInputRef.current;

        if (!input) {
            return;
        }

        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }, [isEditing]);

    return (
        <li
            className={[todo.completed ? 'completed' : '', isEditing ? 'editing' : '']
                .filter(Boolean)
                .join(' ')}
        >
            <div className="view">
                <input
                    className="toggle"
                    type="checkbox"
                    checked={todo.completed}
                    onChange={(event) => {
                        state.setTodoCompleted(todo.id, event.currentTarget.checked);
                    }}
                />
                <label
                    onDoubleClick={() => {
                        state.startEditing(todo.id);
                    }}
                >
                    {todo.title}
                </label>
                <button
                    className="destroy"
                    onClick={() => {
                        state.removeTodo(todo.id);
                    }}
                />
            </div>
            {isEditing ? (
                <input
                    ref={editInputRef}
                    className="edit"
                    defaultValue={todo.title}
                    onBlur={(event) => {
                        if (cancelledRef.current) {
                            cancelledRef.current = false;
                            state.cancelEditing();
                            return;
                        }

                        state.commitEditing(todo.id, event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === ENTER_KEY) {
                            event.currentTarget.blur();
                            return;
                        }

                        if (event.key === ESCAPE_KEY) {
                            cancelledRef.current = true;
                            event.currentTarget.value = todo.title;
                            event.currentTarget.blur();
                        }
                    }}
                />
            ) : null}
        </li>
    );
});
