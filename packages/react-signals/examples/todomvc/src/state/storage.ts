import type { Todo } from './todos';

const DEFAULT_STORAGE_KEY = '@haragei/react-signals/examples/todomvc';

function sanitizeTodo(value: unknown): Todo | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as {
        id?: unknown;
        title?: unknown;
        completed?: unknown;
    };

    if (
        typeof candidate.id !== 'string'
        || typeof candidate.title !== 'string'
        || typeof candidate.completed !== 'boolean'
    ) {
        return null;
    }

    return {
        id: candidate.id,
        title: candidate.title,
        completed: candidate.completed,
    };
}

export function loadTodos(storageKey: string = DEFAULT_STORAGE_KEY): Todo[] {
    if (typeof localStorage === 'undefined') {
        return [];
    }

    const raw = localStorage.getItem(storageKey);

    if (!raw) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        const values = Array.isArray(parsed)
            ? parsed
            : typeof parsed === 'object'
                && parsed !== null
                && Array.isArray((parsed as { todos?: unknown }).todos)
              ? (parsed as { todos: unknown[] }).todos
              : [];

        return values.flatMap((value) => {
            const todo = sanitizeTodo(value);
            return todo ? [todo] : [];
        });
    } catch {
        return [];
    }
}

export function saveTodos(todos: readonly Todo[], storageKey: string = DEFAULT_STORAGE_KEY): void {
    if (typeof localStorage === 'undefined') {
        return;
    }

    localStorage.setItem(storageKey, JSON.stringify({ todos }));
}
