import { subscribe, type SignalReader } from '@haragei/signals';
import type { Todo, TodoAppState, TodoFilter } from '../state/todos';

const ENTER_KEY = 'Enter';
const ESCAPE_KEY = 'Escape';

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderTodoItem(todo: Todo, isEditing: boolean): string {
    const classes = [todo.completed ? 'completed' : '', isEditing ? 'editing' : '']
        .filter(Boolean)
        .join(' ');

    return `
        <li data-id="${escapeHtml(todo.id)}" class="${classes}">
            <div class="view">
                <input class="toggle" type="checkbox" ${todo.completed ? 'checked' : ''}>
                <label>${escapeHtml(todo.title)}</label>
                <button class="destroy"></button>
            </div>
            ${isEditing ? `<input class="edit" value="${escapeHtml(todo.title)}">` : ''}
        </li>
    `;
}

export class TodoAppView {
    private readonly newTodoInput: HTMLInputElement;
    private readonly mainSection: HTMLElement;
    private readonly toggleAllInput: HTMLInputElement;
    private readonly todoList: HTMLUListElement;
    private readonly footer: HTMLElement;
    private readonly todoCount: HTMLElement;
    private readonly clearCompletedButton: HTMLButtonElement;
    private readonly filterLinks: Map<TodoFilter, HTMLAnchorElement>;
    private lastEditingId: string | null = null;

    constructor(root: HTMLElement) {
        this.newTodoInput = query<HTMLInputElement>(root, '.new-todo');
        this.mainSection = query<HTMLElement>(root, '.main');
        this.toggleAllInput = query<HTMLInputElement>(root, '.toggle-all');
        this.todoList = query<HTMLUListElement>(root, '.todo-list');
        this.footer = query<HTMLElement>(root, '.footer');
        this.todoCount = query<HTMLElement>(root, '.todo-count');
        this.clearCompletedButton = query<HTMLButtonElement>(root, '.clear-completed');
        this.filterLinks = new Map<TodoFilter, HTMLAnchorElement>([
            ['all', query<HTMLAnchorElement>(root, '.filters a[href="#/"]')],
            ['active', query<HTMLAnchorElement>(root, '.filters a[href="#/active"]')],
            ['completed', query<HTMLAnchorElement>(root, '.filters a[href="#/completed"]')],
        ]);
    }

    connect(state: TodoAppState): () => void {
        const cleanups: Array<() => void> = [];

        const bind = <T>(read: SignalReader<T>, update: () => void): void => {
            update();
            cleanups.push(subscribe(read, update));
        };

        bind(state.hasTodos, () => {
            const visible = state.hasTodos();
            this.mainSection.hidden = !visible;
            this.footer.hidden = !visible;
        });

        bind(state.allCompleted, () => {
            this.toggleAllInput.checked = state.allCompleted();
        });

        bind(state.activeCount, () => {
            const count = state.activeCount();
            this.todoCount.innerHTML = `<strong>${count}</strong> ${count === 1 ? 'item' : 'items'} left`;
        });

        bind(state.completedCount, () => {
            this.clearCompletedButton.hidden = state.completedCount() === 0;
        });

        bind(state.filter, () => {
            const current = state.filter();

            for (const [filter, link] of this.filterLinks.entries()) {
                link.className = filter === current ? 'selected' : '';
            }
        });

        const renderTodoList = () => {
            const currentEditingId = state.editingId();

            this.todoList.innerHTML = state
                .visibleTodos()
                .map((todo) => renderTodoItem(todo, currentEditingId === todo.id))
                .join('');

            if (currentEditingId && currentEditingId !== this.lastEditingId) {
                const editInput = this.todoList.querySelector<HTMLInputElement>(
                    `li[data-id="${CSS.escape(currentEditingId)}"] .edit`,
                );

                editInput?.focus();
                editInput?.setSelectionRange(editInput.value.length, editInput.value.length);
            }

            this.lastEditingId = currentEditingId;
        };

        renderTodoList();
        cleanups.push(subscribe(state.visibleTodos, renderTodoList));
        cleanups.push(subscribe(state.editingId, renderTodoList));

        const onNewTodoKeyDown = (event: KeyboardEvent) => {
            if (event.key !== ENTER_KEY) {
                return;
            }

            if (state.addTodo(this.newTodoInput.value)) {
                this.newTodoInput.value = '';
            }
        };

        const onToggleAllChange = () => {
            state.toggleAll(this.toggleAllInput.checked);
        };

        const onClearCompletedClick = () => {
            state.clearCompleted();
        };

        const onTodoListChange = (event: Event) => {
            const target = event.target;

            if (!(target instanceof HTMLInputElement) || !target.classList.contains('toggle')) {
                return;
            }

            const id = getTodoId(target);

            if (id) {
                state.setTodoCompleted(id, target.checked);
            }
        };

        const onTodoListClick = (event: MouseEvent) => {
            const target = event.target;

            if (!(target instanceof HTMLElement) || !target.classList.contains('destroy')) {
                return;
            }

            const id = getTodoId(target);

            if (id) {
                state.removeTodo(id);
            }
        };

        const onTodoListDoubleClick = (event: MouseEvent) => {
            const target = event.target;

            if (!(target instanceof HTMLElement) || target.tagName !== 'LABEL') {
                return;
            }

            const id = getTodoId(target);

            if (id) {
                state.startEditing(id);
            }
        };

        const onTodoListKeyDown = (event: KeyboardEvent) => {
            const target = event.target;

            if (!(target instanceof HTMLInputElement) || !target.classList.contains('edit')) {
                return;
            }

            if (event.key === ENTER_KEY) {
                target.blur();
            }

            if (event.key === ESCAPE_KEY) {
                target.dataset.cancelled = 'true';
                target.blur();
            }
        };

        const onTodoListFocusOut = (event: FocusEvent) => {
            const target = event.target;

            if (!(target instanceof HTMLInputElement) || !target.classList.contains('edit')) {
                return;
            }

            if (target.dataset.cancelled === 'true') {
                delete target.dataset.cancelled;
                state.cancelEditing();
                return;
            }

            const id = getTodoId(target);

            if (id) {
                state.commitEditing(id, target.value);
            }
        };

        this.newTodoInput.addEventListener('keydown', onNewTodoKeyDown);
        this.toggleAllInput.addEventListener('change', onToggleAllChange);
        this.clearCompletedButton.addEventListener('click', onClearCompletedClick);
        this.todoList.addEventListener('change', onTodoListChange);
        this.todoList.addEventListener('click', onTodoListClick);
        this.todoList.addEventListener('dblclick', onTodoListDoubleClick);
        this.todoList.addEventListener('keydown', onTodoListKeyDown);
        this.todoList.addEventListener('focusout', onTodoListFocusOut);

        cleanups.push(() => {
            this.newTodoInput.removeEventListener('keydown', onNewTodoKeyDown);
            this.toggleAllInput.removeEventListener('change', onToggleAllChange);
            this.clearCompletedButton.removeEventListener('click', onClearCompletedClick);
            this.todoList.removeEventListener('change', onTodoListChange);
            this.todoList.removeEventListener('click', onTodoListClick);
            this.todoList.removeEventListener('dblclick', onTodoListDoubleClick);
            this.todoList.removeEventListener('keydown', onTodoListKeyDown);
            this.todoList.removeEventListener('focusout', onTodoListFocusOut);
        });

        return () => {
            for (const cleanup of cleanups) {
                cleanup();
            }
        };
    }
}

function getTodoId(target: HTMLElement): string | null {
    return target.closest<HTMLLIElement>('li')?.dataset.id ?? null;
}

function query<ElementType extends Element>(root: HTMLElement, selector: string): ElementType {
    const element = root.querySelector<ElementType>(selector);

    if (!element) {
        throw new Error(`Missing required element: ${selector}`);
    }

    return element;
}
