#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateTask, runPilot, localOps, solConfig, workerConfig } from './lib/pilot-core.mjs';

export function parseArgs(args) {
  const options = { cwd: process.cwd(), turnTimeoutMs: 900000, execute: false };
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--execute') { options.execute = true; continue; }
    if (!['--cwd', '--task', '--out', '--turn-timeout-ms'].includes(name)) throw new Error('unknown option ' + name);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('missing value for ' + name);
    if (name === '--turn-timeout-ms') options.turnTimeoutMs = Number(value);
    else options[name.slice(2)] = value;
  }
  if (!options.task) throw new Error('--task path is required');
  if (!Number.isSafeInteger(options.turnTimeoutMs) || options.turnTimeoutMs < 1000 || options.turnTimeoutMs > 3600000) throw new Error('turn-timeout-ms must be 1000..3600000');
  options.cwd = resolve(options.cwd);
  options.task = resolve(options.task);
  if (options.out) {
    options.out = resolve(options.out);
    const rel = relative(options.cwd, options.out);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('--out must be outside tested checkout');
  }
  return options;
}

export async function main(args, loadSdk = () => import('@getpaseo/client')) {
  const opts = parseArgs(args);
  const task = validateTask(JSON.parse(readFileSync(opts.task, 'utf8')));
  if (!opts.execute) {
    console.log(JSON.stringify({ dryRun: true, taskId: task.id, cwd: opts.cwd, sol: solConfig(), worker: workerConfig(), checks: task.checks,
      warning: 'No models called. --execute opts into paid Paseo runs; exact tokens are NOT measured by this runner.' }, null, 2));
    return 0;
  }
  const { createPaseoClient } = await loadSdk();
  const client = createPaseoClient({ url: process.env.PASEO_URL || 'ws://127.0.0.1:6767/ws',
    ...(process.env.PASEO_PASSWORD ? { password: process.env.PASEO_PASSWORD } : {}) });
  let result;
  try {
    await client.connect();
    result = await runPilot({ client, cwd: opts.cwd, rawTask: task, ops: localOps(opts.cwd), turnTimeoutMs: opts.turnTimeoutMs });
  } finally { await client.close(); }
  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'accepted' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
}
