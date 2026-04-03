import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const inputFiles = process.argv.slice(2);

if (inputFiles.length === 0) {
    console.error('Expected at least one bundle path.');
    process.exit(1);
}

function formatBytes(bytes) {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const exponent =
        bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;

    if (exponent === 0) {
        return `${value} ${units[exponent]}`;
    }

    return `${value.toFixed(2)} ${units[exponent]}`;
}

const rows = inputFiles.map((inputFile) => {
    const filePath = resolve(process.cwd(), inputFile);
    const file = basename(filePath);
    const source = readFileSync(filePath);
    const gzipBytes = gzipSync(source, { level: 9 }).length;
    const brotliBytes = brotliCompressSync(source, {
        params: {
            [constants.BROTLI_PARAM_QUALITY]: 11,
        },
    }).length;

    return {
        file,
        raw: formatBytes(source.length),
        gzip: formatBytes(gzipBytes),
        brotli: formatBytes(brotliBytes),
    };
});

const fileWidth = Math.max('File'.length, ...rows.map((row) => row.file.length));
const rawWidth = Math.max('Raw'.length, ...rows.map((row) => row.raw.length));
const gzipWidth = Math.max('Gzip'.length, ...rows.map((row) => row.gzip.length));
const brotliWidth = Math.max('Brotli'.length, ...rows.map((row) => row.brotli.length));

const divider = [
    '-'.repeat(fileWidth),
    '-'.repeat(rawWidth),
    '-'.repeat(gzipWidth),
    '-'.repeat(brotliWidth),
].join(' | ');

console.log('\nBundle sizes:');
console.log(
    [
        'File'.padEnd(fileWidth),
        'Raw'.padStart(rawWidth),
        'Gzip'.padStart(gzipWidth),
        'Brotli'.padStart(brotliWidth),
    ].join(' | '),
);
console.log(divider);

for (const row of rows) {
    console.log(
        [
            row.file.padEnd(fileWidth),
            row.raw.padStart(rawWidth),
            row.gzip.padStart(gzipWidth),
            row.brotli.padStart(brotliWidth),
        ].join(' | '),
    );
}
