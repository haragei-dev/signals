import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

export interface RenderResult {
    readonly container: HTMLDivElement;
    unmount(): Promise<void>;
}

export async function render(element: ReactElement): Promise<RenderResult> {
    const container = document.createElement('div');
    document.body.append(container);

    const root = createRoot(container);

    await act(async () => {
        root.render(element);
    });

    return {
        container,
        async unmount(): Promise<void> {
            await act(async () => {
                root.unmount();
            });

            container.remove();
        },
    };
}

export async function hydrate(container: HTMLDivElement, element: ReactElement): Promise<void> {
    await act(async () => {
        hydrateRoot(container, element);
    });
}

export async function flushMicrotasks(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}
