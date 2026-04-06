import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['./src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: './tsconfig.build.json',
    attw: {
        level: 'error',
    },
    fixedExtension: true,
    target: 'es2022',
    platform: 'neutral',
    outDir: 'package/dist',
    sourcemap: true,
    clean: true,
    minify: false,
});
