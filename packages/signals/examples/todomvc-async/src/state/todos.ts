import { createStore, type SignalReader } from '@haragei/signals';
import type { Todo, TodoFilter, TodosResponse } from '../api/contracts';
import { fetchTodos, submitTodoMutation, type TodoMutation } from './api';

export type TodoStatusTone = 'idle' | 'info' | 'success' | 'error';
export type TodoStatusAction = 'none' | 'retry' | 'dismiss';

interface PendingMutation {
    readonly id: string;
    readonly mutation: TodoMutation;
}

export interface TodoAppState {
    readonly visibleTodos: SignalReader<readonly Todo[]>;
    readonly filter: SignalReader<TodoFilter>;
    readonly activeCount: SignalReader<number>;
    readonly completedCount: SignalReader<number>;
    readonly allCompleted: SignalReader<boolean>;
    readonly hasTodos: SignalReader<boolean>;
    readonly editingId: SignalReader<string | null>;
    readonly isBusy: SignalReader<boolean>;
    readonly statusText: SignalReader<string | null>;
    readonly statusTone: SignalReader<TodoStatusTone>;
    readonly statusAction: SignalReader<TodoStatusAction>;

    readonly addTodo: (title: string) => boolean;
    readonly setTodoCompleted: (id: string, completed: boolean) => void;
    readonly removeTodo: (id: string) => void;
    readonly clearCompleted: () => void;
    readonly toggleAll: (completed: boolean) => void;
    readonly startEditing: (id: string) => void;
    readonly commitEditing: (id: string, title: string) => void;
    readonly cancelEditing: () => void;
    readonly refreshTodos: () => void;
    readonly dismissError: () => void;
    readonly destroy: () => Promise<void>;
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

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return 'Request failed.';
}

function createClientId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createEmptyTodosResponse(): TodosResponse {
    return {
        todos: [],
        totalCount: 0,
        activeCount: 0,
        completedCount: 0,
    };
}

function matchesFilter(todo: Todo, filter: TodoFilter): boolean {
    switch (filter) {
        case 'active':
            return !todo.completed;
        case 'completed':
            return todo.completed;
        default:
            return true;
    }
}

function applyMutation(
    snapshot: TodosResponse,
    mutation: TodoMutation,
    filter: TodoFilter,
): TodosResponse {
    switch (mutation.kind) {
        case 'create': {
            const createdTodo: Todo = {
                id: mutation.clientId,
                title: mutation.title,
                completed: false,
            };

            return {
                todos: matchesFilter(createdTodo, filter)
                    ? [...snapshot.todos, createdTodo]
                    : snapshot.todos,
                totalCount: snapshot.totalCount + 1,
                activeCount: snapshot.activeCount + 1,
                completedCount: snapshot.completedCount,
            };
        }
        case 'update': {
            const previousTodo = snapshot.todos.find((todo) => todo.id === mutation.id);

            if (!previousTodo) {
                return snapshot;
            }

            const nextTodo: Todo = {
                ...previousTodo,
                ...(mutation.patch.title !== undefined ? { title: mutation.patch.title } : {}),
                ...(typeof mutation.patch.completed === 'boolean'
                    ? { completed: mutation.patch.completed }
                    : {}),
            };

            const previousVisible = matchesFilter(previousTodo, filter);
            const nextVisible = matchesFilter(nextTodo, filter);

            return {
                todos: previousVisible
                    ? nextVisible
                        ? snapshot.todos.map((todo) => (todo.id === nextTodo.id ? nextTodo : todo))
                        : snapshot.todos.filter((todo) => todo.id !== nextTodo.id)
                    : nextVisible
                      ? [...snapshot.todos, nextTodo]
                      : snapshot.todos,
                totalCount: snapshot.totalCount,
                activeCount:
                    previousTodo.completed === nextTodo.completed
                        ? snapshot.activeCount
                        : nextTodo.completed
                          ? snapshot.activeCount - 1
                          : snapshot.activeCount + 1,
                completedCount:
                    previousTodo.completed === nextTodo.completed
                        ? snapshot.completedCount
                        : nextTodo.completed
                          ? snapshot.completedCount + 1
                          : snapshot.completedCount - 1,
            };
        }
        case 'remove': {
            const removedTodo = snapshot.todos.find((todo) => todo.id === mutation.id);

            if (!removedTodo) {
                return snapshot;
            }

            return {
                todos: snapshot.todos.filter((todo) => todo.id !== mutation.id),
                totalCount: snapshot.totalCount - 1,
                activeCount: removedTodo.completed
                    ? snapshot.activeCount
                    : snapshot.activeCount - 1,
                completedCount: removedTodo.completed
                    ? snapshot.completedCount - 1
                    : snapshot.completedCount,
            };
        }
        case 'clearCompleted':
            return {
                todos:
                    filter === 'completed'
                        ? []
                        : filter === 'all'
                          ? snapshot.todos.filter((todo) => !todo.completed)
                          : snapshot.todos,
                totalCount: snapshot.activeCount,
                activeCount: snapshot.activeCount,
                completedCount: 0,
            };
        case 'toggleAll':
            return {
                todos:
                    filter === 'all'
                        ? snapshot.todos.map((todo) => ({ ...todo, completed: mutation.completed }))
                        : filter === 'active'
                          ? mutation.completed
                              ? []
                              : snapshot.todos
                          : mutation.completed
                            ? snapshot.todos
                            : [],
                totalCount: snapshot.totalCount,
                activeCount: mutation.completed ? 0 : snapshot.totalCount,
                completedCount: mutation.completed ? snapshot.totalCount : 0,
            };
    }
}

export function createTodoAppState(): TodoAppState {
    const store = createStore();

    const lifecycleController = new AbortController();

    const [serverSnapshot, setServerSnapshot] = store.signal<TodosResponse>(
        createEmptyTodosResponse(),
    );
    const [pendingMutations, setPendingMutations] = store.signal<readonly PendingMutation[]>([]);
    const [filter, setFilter] = store.signal<TodoFilter>(
        typeof window === 'undefined' ? 'all' : parseFilter(window.location.hash),
    );
    const [editingId, setEditingId] = store.signal<string | null>(null);

    const [todosResourceRead, resourceControls] = store.resource<TodosResponse>(
        async ({ signal }) => {
            return await fetchTodos(filter(), signal);
        },
    );

    const [mutationRead, mutationControls] = store.action<
        TodosResponse,
        [TodoMutation, TodoFilter]
    >(
        async ({ signal }, mutation, currentFilter) => {
            return await submitTodoMutation(mutation, currentFilter, signal);
        },
        {
            concurrency: 'queue',
        },
    );

    store.effect(() => {
        const state = todosResourceRead();

        if (state.status === 'ready') {
            setServerSnapshot(state.value);
        }
    });

    store.effect(({ onCleanup }) => {
        if (mutationRead().status === 'success') {
            const timer = setTimeout(() => mutationControls.reset(), 1500);
            onCleanup(() => clearTimeout(timer));
        }
    });

    const optimisticSnapshot = store.memo(() =>
        pendingMutations().reduce<TodosResponse>(
            (current, entry) => applyMutation(current, entry.mutation, filter()),
            serverSnapshot(),
        ),
    );

    const activeCount = store.memo(() => optimisticSnapshot().activeCount);
    const completedCount = store.memo(() => optimisticSnapshot().completedCount);
    const visibleTodos = store.memo(() => optimisticSnapshot().todos);
    const hasTodos = store.memo(() => optimisticSnapshot().totalCount > 0);
    const allCompleted = store.memo(() => hasTodos() && activeCount() === 0);

    const isBusy = store.memo(() => {
        const resourceState = todosResourceRead();
        const mutationState = mutationRead();

        return resourceState.status === 'loading' || mutationState.status === 'pending';
    });

    const statusText = store.memo(() => {
        const mutationState = mutationRead();

        if (mutationState.status === 'pending') {
            return 'Saving changes\u2026';
        }

        if (mutationState.status === 'success') {
            return 'Saved!';
        }

        if (mutationState.status === 'error') {
            return toErrorMessage(mutationState.error);
        }

        const resourceState = todosResourceRead();

        if (resourceState.status === 'loading') {
            return optimisticSnapshot().totalCount === 0
                ? 'Loading todos\u2026'
                : 'Refreshing todos\u2026';
        }

        if (resourceState.status === 'error') {
            return toErrorMessage(resourceState.error);
        }

        return null;
    });

    const statusTone = store.memo<TodoStatusTone>(() => {
        const mutationState = mutationRead();

        if (mutationState.status === 'error') {
            return 'error';
        }

        if (mutationState.status === 'success') {
            return 'success';
        }

        if (todosResourceRead().status === 'error') {
            return 'error';
        }

        if (isBusy()) {
            return 'info';
        }

        return 'idle';
    });

    const statusAction = store.memo<TodoStatusAction>(() => {
        if (mutationRead().status === 'error') {
            return 'dismiss';
        }

        if (todosResourceRead().status === 'error') {
            return 'retry';
        }

        return 'none';
    });

    const onHashChange = () => {
        store.batch(() => {
            setFilter(parseFilter(window.location.hash));
            setEditingId(null);
        });
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('hashchange', onHashChange);
    }

    const submitMutation = async (mutation: TodoMutation): Promise<void> => {
        const pendingId = createClientId();

        setPendingMutations((previous) => [...previous, { id: pendingId, mutation }]);

        try {
            const nextTodos = await mutationControls.submitWith(
                { signal: lifecycleController.signal },
                mutation,
                filter(),
            );
            store.batch(() => {
                setServerSnapshot(nextTodos);
                setPendingMutations((previous) =>
                    previous.filter((entry) => entry.id !== pendingId),
                );
            });
        } catch {
            setPendingMutations((previous) => previous.filter((entry) => entry.id !== pendingId));
        }
    };

    const addTodo = (title: string): boolean => {
        const trimmed = title.trim();

        if (!trimmed) {
            return false;
        }

        void submitMutation({
            kind: 'create',
            clientId: createClientId(),
            title: trimmed,
        });

        return true;
    };

    const setTodoCompleted = (id: string, completed: boolean): void => {
        void submitMutation({
            kind: 'update',
            id,
            patch: { completed },
        });
    };

    const removeTodo = (id: string): void => {
        if (editingId() === id) {
            setEditingId(null);
        }

        void submitMutation({
            kind: 'remove',
            id,
        });
    };

    const clearCompleted = (): void => {
        const currentEditingId = editingId();

        if (
            currentEditingId !== null
            && optimisticSnapshot().todos.some(
                (todo) => todo.id === currentEditingId && todo.completed,
            )
        ) {
            setEditingId(null);
        }

        void submitMutation({
            kind: 'clearCompleted',
        });
    };

    const toggleAll = (completed: boolean): void => {
        void submitMutation({
            kind: 'toggleAll',
            completed,
        });
    };

    const startEditing = (id: string): void => {
        if (optimisticSnapshot().todos.some((todo) => todo.id === id)) {
            setEditingId(id);
        }
    };

    const commitEditing = (id: string, title: string): void => {
        const trimmed = title.trim();

        if (!trimmed) {
            removeTodo(id);
            return;
        }

        setEditingId(null);

        void submitMutation({
            kind: 'update',
            id,
            patch: { title: trimmed },
        });
    };

    const cancelEditing = (): void => {
        setEditingId(null);
    };

    const refreshTodos = (): void => {
        resourceControls.refresh();
    };

    const dismissError = (): void => {
        mutationControls.reset();
    };

    const destroy = async (): Promise<void> => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('hashchange', onHashChange);
        }

        lifecycleController.abort();
        resourceControls.abort();
        await store.unlink();
    };

    return {
        visibleTodos,
        filter,
        activeCount,
        completedCount,
        allCompleted,
        hasTodos,
        editingId,
        isBusy,
        statusText,
        statusTone,
        statusAction,
        addTodo,
        setTodoCompleted,
        removeTodo,
        clearCompleted,
        toggleAll,
        startEditing,
        commitEditing,
        cancelEditing,
        refreshTodos,
        dismissError,
        destroy,
    };
}
