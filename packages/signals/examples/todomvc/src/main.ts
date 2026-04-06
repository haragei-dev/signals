import 'todomvc-common/base.css';
import 'todomvc-app-css/index.css';

import { createTodoAppState } from './state/todos';
import { TodoAppView } from './ui/view';

const root = document.querySelector<HTMLElement>('.todoapp');

if (!root) {
    throw new Error('Missing .todoapp root element');
}

const state = createTodoAppState();
const view = new TodoAppView(root);
const disconnect = view.connect(state);

window.addEventListener(
    'pagehide',
    () => {
        disconnect();
        void state.destroy();
    },
    { once: true },
);
