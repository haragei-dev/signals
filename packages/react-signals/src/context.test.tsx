// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
    SignalsProvider,
    useSignal,
    useSignalAction,
    useSignalMemo,
    useSignalResource,
    useSignalScope,
} from './index';

describe('SignalsProvider SSR', () => {
    it('throws when creator hooks are used on the server without a provider store.', () => {
        function App(): React.JSX.Element {
            const signal = useSignal(1);
            return <span>{signal.read()}</span>;
        }

        expect(() => {
            renderToString(<App />);
        }).toThrow('SignalsProvider is required when creating signals during server rendering.');
    });

    it('renders provider-backed creator hooks safely on the server.', () => {
        function App(): React.JSX.Element {
            const signal = useSignal(2);
            const memo = useSignalMemo(() => signal.read() * 2);
            const [resourceRead] = useSignalResource(async () => 1);
            const [actionRead] = useSignalAction(async () => 1);

            return (
                <span>
                    {signal.read()}:{memo()}:{resourceRead().status}:{actionRead().status}
                </span>
            );
        }

        expect(
            renderToString(
                <SignalsProvider>
                    <App />
                </SignalsProvider>,
            ).replaceAll('<!-- -->', ''),
        ).toContain('2:4:idle:idle');
    });

    it('renders provider-backed scoped subtrees safely on the server.', () => {
        function Scoped(): React.JSX.Element {
            const scope = useSignalScope();

            return (
                <SignalsProvider store={scope}>
                    <Child />
                </SignalsProvider>
            );
        }

        function Child(): React.JSX.Element {
            const signal = useSignal(3);
            return <span>{signal.read()}</span>;
        }

        expect(
            renderToString(
                <SignalsProvider>
                    <Scoped />
                </SignalsProvider>,
            ).replaceAll('<!-- -->', ''),
        ).toContain('3');
    });
});
