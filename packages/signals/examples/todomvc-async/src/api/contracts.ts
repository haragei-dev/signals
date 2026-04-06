export type TodoFilter = 'all' | 'active' | 'completed';

export interface Todo {
    readonly id: string;
    readonly title: string;
    readonly completed: boolean;
}

export interface TodosResponse {
    readonly todos: readonly Todo[];
    readonly totalCount: number;
    readonly activeCount: number;
    readonly completedCount: number;
}

export interface ApiErrorResponse {
    readonly error: string;
}

export interface CreateTodoRequest {
    readonly title: string;
}

export interface UpdateTodoRequest {
    readonly title?: string;
    readonly completed?: boolean;
}

export interface ToggleAllTodosRequest {
    readonly completed: boolean;
}
