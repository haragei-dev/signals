import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Todo } from '../src/api/contracts';

interface TodoFile {
    readonly todos: readonly Todo[];
}

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const dataFilePath = resolve(currentDir, 'data', 'todos.json');

let queue = Promise.resolve();

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

async function ensureDataFile(): Promise<void> {
    await mkdir(dirname(dataFilePath), { recursive: true });

    try {
        await readFile(dataFilePath, 'utf8');
    } catch {
        await writeFile(dataFilePath, JSON.stringify({ todos: [] }, null, 2) + '\n', 'utf8');
    }
}

async function loadTodoFile(): Promise<TodoFile> {
    await ensureDataFile();

    try {
        const raw = await readFile(dataFilePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        const todos = Array.isArray((parsed as TodoFile | undefined)?.todos)
            ? (parsed as TodoFile).todos.flatMap((todo) => {
                  const sanitized = sanitizeTodo(todo);
                  return sanitized ? [sanitized] : [];
              })
            : [];

        return { todos };
    } catch {
        return { todos: [] };
    }
}

async function saveTodoFile(file: TodoFile): Promise<void> {
    await ensureDataFile();
    await writeFile(dataFilePath, JSON.stringify(file, null, 2) + '\n', 'utf8');
}

function runSerialized<T>(execute: () => Promise<T>): Promise<T> {
    const next = queue.then(execute, execute);
    queue = next.then(
        () => undefined,
        () => undefined,
    );
    return next;
}

export async function readTodos(): Promise<readonly Todo[]> {
    return (await loadTodoFile()).todos;
}

export async function mutateTodos(
    mutate: (previous: readonly Todo[]) => readonly Todo[],
): Promise<readonly Todo[]> {
    return runSerialized(async () => {
        const current = await loadTodoFile();
        const nextTodos = mutate(current.todos);

        await saveTodoFile({ todos: nextTodos });

        return nextTodos;
    });
}
