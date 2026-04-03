import { defineConfig, mergeConfig } from 'vitest/config';

import sharedConfig from '../../vitest.config';

export default mergeConfig(
    sharedConfig,
    defineConfig({
        test: {
            include: ['src/**/*.test.ts'],
            coverage: {
                include: ['src/**/*.ts'],
                exclude: [
                    '**/*.test.ts',
                    'src/index.ts',
                    'src/store/internal.ts',
                    'src/store/types.ts',
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
