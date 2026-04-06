import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createTodoApi } from './app';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        host: {
            type: 'string',
            default: '127.0.0.1',
        },
        port: {
            type: 'string',
            default: '4174',
        },
        'static-dir': {
            type: 'string',
        },
    },
});

const app = await createTodoApi({
    ...(values['static-dir'] ? { staticDir: resolve(currentDir, '..', values['static-dir']) } : {}),
});

try {
    await app.listen({
        host: values.host,
        port: Number.parseInt(values.port, 10),
    });
} catch (error) {
    app.log.error(error);
    process.exit(1);
}
