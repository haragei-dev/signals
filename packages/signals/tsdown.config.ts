import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['./src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    attw: {
        level: 'error',
    },
    fixedExtension: true,
    target: 'es2022',
    platform: 'node',
    outDir: 'package/dist',
    sourcemap: true,
    clean: true,
    minify: false,
});
