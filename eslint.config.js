import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tsESlint from 'typescript-eslint';

export default defineConfig(
    {
        ignores: ['**/dist/**', '**/coverage/**', '**/.release-artifacts/**', '**/*.d.ts'],
    },
    {
        files: ['eslint.config.js', 'vitest.config.ts', 'scripts/**/*.{js,mjs,cjs,ts}'],
        languageOptions: {
            globals: globals.node,
        },
    },
    eslint.configs.recommended,
    tsESlint.configs.recommended,
);
