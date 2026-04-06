import type {
    ApiErrorResponse,
    CreateTodoRequest,
    TodoFilter,
    TodosResponse,
    ToggleAllTodosRequest,
    UpdateTodoRequest,
} from '../api/contracts';

export type TodoMutation =
    | {
          readonly kind: 'create';
          readonly clientId: string;
          readonly title: string;
      }
    | {
          readonly kind: 'update';
          readonly id: string;
          readonly patch: UpdateTodoRequest;
      }
    | {
          readonly kind: 'remove';
          readonly id: string;
      }
    | {
          readonly kind: 'clearCompleted';
      }
    | {
          readonly kind: 'toggleAll';
          readonly completed: boolean;
      };

async function parseResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
        return (await response.json()) as T;
    }

    let message = `${response.status} ${response.statusText}`.trim();

    try {
        const payload = (await response.json()) as Partial<ApiErrorResponse>;

        if (typeof payload.error === 'string' && payload.error) {
            message = payload.error;
        }
    } catch {
        // Ignore malformed API errors and fall back to the HTTP status text.
    }

    throw new Error(message);
}

function createTodosUrl(filter: TodoFilter): string {
    const search = new URLSearchParams({ filter });
    return `/api/todos?${search.toString()}`;
}

export async function fetchTodos(filter: TodoFilter, signal?: AbortSignal): Promise<TodosResponse> {
    const response = await fetch(createTodosUrl(filter), {
        ...(signal ? { signal } : {}),
    });
    return await parseResponse<TodosResponse>(response);
}

export async function submitTodoMutation(
    mutation: TodoMutation,
    filter: TodoFilter,
    signal?: AbortSignal,
): Promise<TodosResponse> {
    const request = (() => {
        const url = createTodosUrl(filter);

        switch (mutation.kind) {
            case 'create':
                return {
                    url,
                    init: {
                        method: 'POST',
                        body: JSON.stringify({ title: mutation.title } satisfies CreateTodoRequest),
                    },
                };
            case 'update':
                return {
                    url: `/api/todos/${encodeURIComponent(mutation.id)}?${new URLSearchParams({
                        filter,
                    }).toString()}`,
                    init: {
                        method: 'PATCH',
                        body: JSON.stringify(mutation.patch),
                    },
                };
            case 'remove':
                return {
                    url: `/api/todos/${encodeURIComponent(mutation.id)}?${new URLSearchParams({
                        filter,
                    }).toString()}`,
                    init: {
                        method: 'DELETE',
                    },
                };
            case 'clearCompleted':
                return {
                    url: `/api/todos/completed?${new URLSearchParams({ filter }).toString()}`,
                    init: {
                        method: 'DELETE',
                    },
                };
            case 'toggleAll':
                return {
                    url: `/api/todos/toggle-all?${new URLSearchParams({ filter }).toString()}`,
                    init: {
                        method: 'POST',
                        body: JSON.stringify({
                            completed: mutation.completed,
                        } satisfies ToggleAllTodosRequest),
                    },
                };
        }
    })();

    const headers =
        'body' in request.init
            ? {
                  'content-type': 'application/json',
              }
            : undefined;

    const response = await fetch(request.url, {
        ...request.init,
        ...(headers ? { headers } : {}),
        ...(signal ? { signal } : {}),
    });

    return await parseResponse<TodosResponse>(response);
}
