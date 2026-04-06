import type { SignalReader, Store } from '@haragei/signals';
import { loadTodos, saveTodos } from './storage';

export interface Todo {
    readonly id: string;
    readonly title: string;
    readonly completed: boolean;
}

export type TodoFilter = 'all' | 'active' | 'completed';

export interface TodoAppState {
    readonly visibleTodos: SignalReader<readonly Todo[]>;
    readonly filter: SignalReader<TodoFilter>;
    readonly activeCount: SignalReader<number>;
    readonly completedCount: SignalReader<number>;
    readonly allCompleted: SignalReader<boolean>;
    readonly hasTodos: SignalReader<boolean>;
    readonly editingId: SignalReader<string | null>;

    readonly addTodo: (title: string) => boolean;
    readonly setTodoCompleted: (id: string, completed: boolean) => void;
    readonly removeTodo: (id: string) => void;
    readonly clearCompleted: () => void;
    readonly toggleAll: (completed: boolean) => void;
    readonly startEditing: (id: string) => void;
    readonly commitEditing: (id: string, title: string) => void;
    readonly cancelEditing: () => void;
    readonly handleHashChange: () => void;
}

function parseFilter(hash: string): TodoFilter {
    switch (hash) {
        case '#/active':
            return 'active';
        case '#/completed':
            return 'completed';
        default:
            return 'all';
    }
}

function createTodoId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createTodoState(store: Store, storageKey?: string): TodoAppState {
    const [todos, setTodos] = store.signal<Todo[]>(loadTodos(storageKey));
    const [filter, setFilter] = store.signal<TodoFilter>(
        typeof window === 'undefined' ? 'all' : parseFilter(window.location.hash),
    );
    const [editingId, setEditingId] = store.signal<string | null>(null);

    const activeCount = store.memo(() => todos().filter((todo) => !todo.completed).length);
    const completedCount = store.memo(() => todos().length - activeCount());
    const visibleTodos = store.memo(() => {
        switch (filter()) {
            case 'active':
                return todos().filter((todo) => !todo.completed);
            case 'completed':
                return todos().filter((todo) => todo.completed);
            default:
                return todos();
        }
    });
    const hasTodos = store.memo(() => todos().length > 0);
    const allCompleted = store.memo(() => hasTodos() && activeCount() === 0);

    store.effect(() => {
        saveTodos(todos(), storageKey);
    });

    const handleHashChange = () => {
        store.batch(() => {
            setFilter(parseFilter(window.location.hash));
            setEditingId(null);
        });
    };

    const addTodo = (title: string): boolean => {
        const trimmed = title.trim();

        if (!trimmed) {
            return false;
        }

        setTodos((previous) => [
            ...previous,
            {
                id: createTodoId(),
                title: trimmed,
                completed: false,
            },
        ]);

        return true;
    };

    const setTodoCompleted = (id: string, completed: boolean): void => {
        setTodos((previous) =>
            previous.map((todo) => (todo.id === id ? { ...todo, completed } : todo)),
        );
    };

    const removeTodo = (id: string): void => {
        store.batch(() => {
            setTodos((previous) => previous.filter((todo) => todo.id !== id));

            if (editingId() === id) {
                setEditingId(null);
            }
        });
    };

    const clearCompleted = (): void => {
        store.batch(() => {
            const currentEditingId = editingId();
            const wasEditingCompleted =
                currentEditingId !== null
                && todos().some((todo) => todo.id === currentEditingId && todo.completed);

            setTodos((previous) => previous.filter((todo) => !todo.completed));

            if (wasEditingCompleted) {
                setEditingId(null);
            }
        });
    };

    const toggleAll = (completed: boolean): void => {
        setTodos((previous) =>
            previous.map((todo) => (todo.completed === completed ? todo : { ...todo, completed })),
        );
    };

    const startEditing = (id: string): void => {
        if (todos().some((todo) => todo.id === id)) {
            setEditingId(id);
        }
    };

    const commitEditing = (id: string, title: string): void => {
        const trimmed = title.trim();

        if (!trimmed) {
            removeTodo(id);
            return;
        }

        store.batch(() => {
            setTodos((previous) =>
                previous.map((todo) => (todo.id === id ? { ...todo, title: trimmed } : todo)),
            );
            setEditingId(null);
        });
    };

    const cancelEditing = (): void => {
        setEditingId(null);
    };

    return {
        visibleTodos,
        filter,
        activeCount,
        completedCount,
        allCompleted,
        hasTodos,
        editingId,
        addTodo,
        setTodoCompleted,
        removeTodo,
        clearCompleted,
        toggleAll,
        startEditing,
        commitEditing,
        cancelEditing,
        handleHashChange,
    };
}
