import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const targetPath = process.argv[2];

if (!targetPath) {
    console.error('Usage: node resolve-workspace-deps.mjs <path-to-package.json>');
    process.exit(1);
}

const resolvedTarget = path.resolve(targetPath);

let workspaceRoot = path.dirname(resolvedTarget);
while (workspaceRoot !== path.dirname(workspaceRoot)) {
    try {
        await readFile(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8');
        break;
    } catch {
        workspaceRoot = path.dirname(workspaceRoot);
    }
}

const packagesDir = path.join(workspaceRoot, 'packages');
const workspaceVersions = new Map();

for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
        continue;
    }

    try {
        const pkg = JSON.parse(
            await readFile(path.join(packagesDir, entry.name, 'package.json'), 'utf8'),
        );

        if (pkg.name && pkg.version) {
            workspaceVersions.set(pkg.name, pkg.version);
        }
    } catch {
        // ignore
    }
}

const targetPkg = JSON.parse(await readFile(resolvedTarget, 'utf8'));
let modified = false;

for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
]) {
    const deps = targetPkg[field];

    if (!deps) {
        continue;
    }

    for (const [name, range] of Object.entries(deps)) {
        if (typeof range !== 'string' || !range.startsWith('workspace:')) {
            continue;
        }

        const version = workspaceVersions.get(name);

        if (!version) {
            console.error(
                `Cannot resolve workspace protocol for "${name}": package not found in workspace.`,
            );
            process.exit(1);
        }

        deps[name] =
            range === 'workspace:*' || range === 'workspace:^'
                ? `^${version}`
                : range === 'workspace:~'
                  ? `~${version}`
                  : version;
        modified = true;
    }
}

if (modified) {
    await writeFile(resolvedTarget, `${JSON.stringify(targetPkg, null, 2)}\n`, 'utf8');
}
