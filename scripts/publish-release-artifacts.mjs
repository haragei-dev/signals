import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const workspaceRoot = process.cwd();
const artifactsDir = path.join(workspaceRoot, '.release-artifacts');
const manifestPath = path.join(artifactsDir, 'manifest.json');
const args = new Map(
    process.argv.slice(2).map((argument) => {
        const [key, value] = argument.split('=');
        return [key, value];
    }),
);

const registry = args.get('--registry');
const tokenEnvName = args.get('--token-env');

if (!registry || !tokenEnvName) {
    throw new Error(
        'Usage: node ./scripts/publish-release-artifacts.mjs --registry=<url> --token-env=<ENV_NAME>',
    );
}

const token = process.env[tokenEnvName];

if (!token) {
    throw new Error(`Missing required token environment variable: ${tokenEnvName}`);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const registryUrl = new URL(registry);
const npmrcPath = path.join(artifactsDir, `${registryUrl.hostname}.npmrc`);
const publishArgs = ['--userconfig', npmrcPath, '--registry', registry];

if (registryUrl.hostname === 'registry.npmjs.org') {
    publishArgs.push('--access', 'public');
}

await writeFile(npmrcPath, `//${registryUrl.host}/:_authToken=${token}\n`, 'utf8');

try {
    for (const entry of manifest) {
        await run('npm', ['publish', path.join(workspaceRoot, entry.tarball), ...publishArgs], {
            cwd: workspaceRoot,
            stdio: 'inherit',
        });
    }
} finally {
    await rm(npmrcPath, { force: true });
}
