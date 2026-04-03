import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import remapping from '@ampproject/remapping';
import { transform } from 'esbuild';

const inputFiles = process.argv.slice(2);

if (inputFiles.length === 0) {
    console.error('Expected at least one JavaScript bundle path.');
    process.exit(1);
}

for (const inputFile of inputFiles) {
    const filePath = resolve(process.cwd(), inputFile);
    const fileName = basename(filePath);
    const format = fileName.endsWith('.cjs') ? 'cjs' : 'esm';
    const mapPath = `${filePath}.map`;
    const source = readFileSync(filePath, 'utf8');
    const previousMap = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, 'utf8')) : null;
    const result = await transform(source, {
        format,
        loader: 'js',
        minify: true,
        minifyIdentifiers: true,
        minifySyntax: true,
        minifyWhitespace: true,
        mangleProps: /^_/,
        sourcemap: 'external',
        sourcefile: fileName,
        target: 'es2022',
    });

    writeFileSync(filePath, result.code);

    if (result.map) {
        const nextMap = JSON.parse(result.map);
        const finalMap = previousMap
            ? remapping(nextMap, (source) => {
                  return source === fileName ? previousMap : null;
              })
            : nextMap;

        finalMap.file = fileName;
        writeFileSync(mapPath, `${JSON.stringify(finalMap)}\n`);
    }
}
