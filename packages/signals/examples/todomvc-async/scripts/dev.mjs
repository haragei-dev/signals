import { spawn } from 'node:child_process';

const children = new Set();

function spawnProcess(name, args) {
    const child = spawn('pnpm', args, {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });

    children.add(child);

    child.on('exit', (code, signal) => {
        children.delete(child);

        if (signal || code) {
            shutdown(code ?? 1);
        }
    });

    return child;
}

let shuttingDown = false;

function shutdown(code = 0) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    for (const child of children) {
        child.kill('SIGTERM');
    }

    setTimeout(() => {
        process.exit(code);
    }, 50).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

spawnProcess('server', ['run', 'dev:server']);
spawnProcess('client', ['run', 'dev:client']);
