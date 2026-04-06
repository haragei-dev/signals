// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
    SignalsProvider,
    useSignal,
    useSignalAction,
    useSignalMemo,
    useSignalResource,
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
});
