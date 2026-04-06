import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    resolve: {
        alias: {
            '@haragei/react-signals': resolve(__dirname, '../../src/index.ts'),
            '@haragei/signals': resolve(__dirname, '../../../signals/src/index.ts'),
        },
    },
});
