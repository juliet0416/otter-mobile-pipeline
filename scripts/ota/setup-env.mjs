import { appendFileSync } from 'node:fs';
import { productionEnv } from './runtime.mjs';
const config = productionEnv(process.argv[2]);
if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV required');
appendFileSync(process.env.GITHUB_ENV, Object.entries(config).map(([k, v]) => `${k}=${v}\n`).join(''));
