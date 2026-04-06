import 'todomvc-common/base.css';
import 'todomvc-app-css/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RenderCountPanel } from './ui/render-count';
import { TodoMvcExample } from './ui/todo-app';

const rootElement = document.querySelector<HTMLElement>('#root');

if (!rootElement) {
    throw new Error('Missing #root element');
}

const root = createRoot(rootElement);

root.render(
    <StrictMode>
        <RenderCountPanel>
            <TodoMvcExample />
        </RenderCountPanel>
    </StrictMode>,
);

window.addEventListener(
    'pagehide',
    () => {
        root.unmount();
    },
    { once: true },
);
