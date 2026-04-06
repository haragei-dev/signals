import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type {
    CreateTodoRequest,
    TodoFilter,
    ToggleAllTodosRequest,
    Todo,
    TodosResponse,
    UpdateTodoRequest,
} from '../src/api/contracts';
import { mutateTodos, readTodos } from './storage';

export interface CreateTodoApiOptions {
    readonly staticDir?: string;
}

const RANDOM_FAILURE_RATE = 0.08;

function createTodoId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toTodosResponse(todos: readonly Todo[]): TodosResponse {
    const activeCount = todos.filter((todo) => !todo.completed).length;

    return {
        todos,
        totalCount: todos.length,
        activeCount,
        completedCount: todos.length - activeCount,
    };
}

function parseFilter(value: string | undefined): TodoFilter {
    switch (value) {
        case 'active':
            return 'active';
        case 'completed':
            return 'completed';
        default:
            return 'all';
    }
}

function filterTodos(todos: readonly Todo[], filter: TodoFilter): readonly Todo[] {
    switch (filter) {
        case 'active':
            return todos.filter((todo) => !todo.completed);
        case 'completed':
            return todos.filter((todo) => todo.completed);
        default:
            return todos;
    }
}

function toTodosViewResponse(todos: readonly Todo[], filter: TodoFilter): TodosResponse {
    const summary = toTodosResponse(todos);

    return {
        ...summary,
        todos: filterTodos(todos, filter),
    };
}

function normalizeTitle(title: string): string {
    return title.trim();
}

function shouldFailRandomly(): boolean {
    return Math.random() < RANDOM_FAILURE_RATE;
}

export async function createTodoApi(options: CreateTodoApiOptions = {}) {
    const app = Fastify({
        logger: true,
    });

    if (options.staticDir) {
        await app.register(fastifyStatic, {
            root: resolve(options.staticDir),
        });
    }

    app.get<{ Querystring: { filter?: string } }>('/api/todos', async (request) => {
        const filter = parseFilter(request.query.filter);

        return toTodosViewResponse(await readTodos(), filter);
    });

    app.post<{ Body: CreateTodoRequest; Querystring: { filter?: string } }>(
        '/api/todos',
        async (request, reply) => {
            const filter = parseFilter(request.query.filter);
            const title = normalizeTitle(request.body.title);

            if (!title) {
                return reply.code(400).send({ error: 'Title is required.' });
            }

            const todos = await mutateTodos((previous) => [
                ...previous,
                {
                    id: createTodoId(),
                    title,
                    completed: false,
                },
            ]);

            if (Math.random() < 0.25) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            return toTodosViewResponse(todos, filter);
        },
    );

    app.patch<{
        Params: { id: string };
        Body: UpdateTodoRequest;
        Querystring: { filter?: string };
    }>('/api/todos/:id', async (request, reply) => {
        const filter = parseFilter(request.query.filter);
        const { id } = request.params;
        const nextTitle =
            typeof request.body.title === 'string' ? normalizeTitle(request.body.title) : undefined;

        if (request.body.title !== undefined && !nextTitle) {
            return reply.code(400).send({ error: 'Title must not be empty.' });
        }

        if (shouldFailRandomly()) {
            return reply.code(503).send({
                error: 'Random failure: update request rejected. Try again.',
            });
        }

        const todos = await mutateTodos((previous) =>
            previous.map((todo) =>
                todo.id === id
                    ? {
                          ...todo,
                          ...(nextTitle !== undefined ? { title: nextTitle } : {}),
                          ...(typeof request.body.completed === 'boolean'
                              ? { completed: request.body.completed }
                              : {}),
                      }
                    : todo,
            ),
        );

        return toTodosViewResponse(todos, filter);
    });

    app.delete<{ Params: { id: string }; Querystring: { filter?: string } }>(
        '/api/todos/:id',
        async (request) => {
            const filter = parseFilter(request.query.filter);
            const todos = await mutateTodos((previous) =>
                previous.filter((todo) => todo.id !== request.params.id),
            );

            return toTodosViewResponse(todos, filter);
        },
    );

    app.delete<{ Querystring: { filter?: string } }>('/api/todos/completed', async (request) => {
        const filter = parseFilter(request.query.filter);
        const todos = await mutateTodos((previous) => previous.filter((todo) => !todo.completed));

        return toTodosViewResponse(todos, filter);
    });

    app.post<{ Body: ToggleAllTodosRequest; Querystring: { filter?: string } }>(
        '/api/todos/toggle-all',
        async (request) => {
            const filter = parseFilter(request.query.filter);
            const todos = await mutateTodos((previous) =>
                previous.map((todo) => ({ ...todo, completed: request.body.completed })),
            );

            return toTodosViewResponse(todos, filter);
        },
    );

    if (options.staticDir) {
        app.get('/', async (_request, reply) => {
            return reply.sendFile('index.html');
        });
    }

    return app;
}
