import { type PropsWithChildren, useEffect, useRef, useState } from 'react';

const counts = new Map<string, { value: number }>();
let panelNotify: (() => void) | null = null;

export function useRenderCount(name: string): void {
    const keyRef = useRef(name);

    if (import.meta.env.DEV) {
        if (!counts.has(keyRef.current)) {
            counts.set(keyRef.current, { value: 0 });
        }

        counts.get(keyRef.current)!.value++;
    }

    useEffect(() => {
        if (import.meta.env.DEV) {
            panelNotify?.();
        }
    });
}

export function RenderCountPanel({ children }: PropsWithChildren) {
    const [, setTick] = useState(0);

    useEffect(() => {
        if (import.meta.env.DEV) {
            panelNotify = () => setTick((n) => n + 1);

            return () => {
                panelNotify = null;
            };
        }

        return undefined;
    }, []);

    const entries = import.meta.env.DEV ? Array.from(counts.entries()) : [];

    return (
        <>
            {children}
            {entries.length > 0 && (
                <div
                    style={{
                        position: 'fixed',
                        bottom: 12,
                        left: 12,
                        background: 'rgba(0, 0, 0, 0.82)',
                        color: '#ccc',
                        fontSize: 11,
                        fontFamily: 'ui-monospace, monospace',
                        padding: '8px 12px',
                        borderRadius: 6,
                        zIndex: 9999,
                        minWidth: 130,
                        lineHeight: '18px',
                        pointerEvents: 'none',
                    }}
                >
                    <div
                        style={{
                            color: '#fff',
                            fontWeight: 600,
                            marginBottom: 4,
                            fontSize: 10,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                        }}
                    >
                        Render counts
                    </div>
                    {entries.map(([name, entry]) => (
                        <div
                            key={name}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 16,
                            }}
                        >
                            <span>{name}</span>
                            <span style={{ color: '#8f8' }}>{entry.value}</span>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
