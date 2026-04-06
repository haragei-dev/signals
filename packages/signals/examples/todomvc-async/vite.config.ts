import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    resolve: {
        alias: {
            '@haragei/signals': resolve(__dirname, '../../src/index.ts'),
        },
    },
    server: {
        proxy: {
            '/api': 'http://127.0.0.1:4174',
        },
    },
});
