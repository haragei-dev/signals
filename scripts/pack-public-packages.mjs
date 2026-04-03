import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const workspaceRoot = process.cwd();
const packagesDir = path.join(workspaceRoot, 'packages');
const artifactsDir = path.join(workspaceRoot, '.release-artifacts');

await rm(artifactsDir, { force: true, recursive: true });
await mkdir(artifactsDir, { recursive: true });

const entries = await readdir(packagesDir, { withFileTypes: true });
const manifest = [];

for (const entry of entries) {
    if (!entry.isDirectory()) {
        continue;
    }

    const packageDir = path.join(packagesDir, entry.name);
    const packageJsonPath = path.join(packageDir, 'package.json');
    try {
        await access(packageJsonPath);
    } catch {
        continue;
    }
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

    if (packageJson.private) {
        continue;
    }

    const stagedPublishDir = path.join(packageDir, 'package');

    await rm(stagedPublishDir, { force: true, recursive: true });
    await run('pnpm', ['exec', 'clean-publish'], {
        cwd: packageDir,
        encoding: 'utf8',
    });

    const { stdout, stderr } = await run(
        'pnpm',
        ['pack', '--pack-destination', path.relative(stagedPublishDir, artifactsDir)],
        {
            cwd: stagedPublishDir,
            encoding: 'utf8',
        },
    );

    if (stderr.trim()) {
        process.stderr.write(stderr);
    }

    const tarballOutput = stdout.trim().split('\n').at(-1);
    const tarballName = tarballOutput ? path.basename(tarballOutput) : null;

    if (!tarballName) {
        throw new Error(`Could not determine tarball name for ${packageJson.name}`);
    }

    manifest.push({
        name: packageJson.name,
        version: packageJson.version,
        packageDir: path.relative(workspaceRoot, packageDir),
        tarball: path.join('.release-artifacts', tarballName),
    });

    await rm(stagedPublishDir, { force: true, recursive: true });
}

if (manifest.length === 0) {
    throw new Error('No public workspace packages were found to pack.');
}

await writeFile(
    path.join(artifactsDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
);
