import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';

import sharedConfig from '../../vitest.config';

const signalsSource = fileURLToPath(new URL('../signals/src/index.ts', import.meta.url));

export default mergeConfig(
    sharedConfig,
    defineConfig({
        resolve: {
            alias: {
                '@haragei/signals': signalsSource,
            },
        },
        test: {
            environment: 'happy-dom',
            include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
            coverage: {
                include: ['src/**/*.ts', 'src/**/*.tsx'],
                exclude: [
                    '**/*.test.ts',
                    '**/*.test.tsx',
                    'src/index.ts',
                    'src/internal.ts',
                    'src/test/**/*',
                ],
                thresholds: {
                    lines: 100,
                    functions: 100,
                    branches: 100,
                    statements: 100,
                },
            },
        },
    }),
);
