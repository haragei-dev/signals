import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    resolve: {
        alias: {
            '@haragei/signals': resolve(__dirname, '../../src/index.ts'),
        },
    },
});
