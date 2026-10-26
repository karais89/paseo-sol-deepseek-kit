#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync, openSync, closeSync, renameSync, realpathSync, unlinkSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateTask, runPilot, localOps, solConfig, workerConfig, bounded, DIFF_MAX } from './lib/pilot-core.mjs';

function outside(base, candidate) {
  const rel = relative(base, candidate);
  return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
}
export function parseArgs(args) {
  const options = { cwd: process.cwd(), turnTimeoutMs: 900000, runTimeoutMs: 1200000, execute: false };
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--execute') { options.execute = true; continue; }
    if (!['--cwd', '--task', '--out', '--turn-timeout-ms', '--run-timeout-ms'].includes(name)) throw new Error('unknown option ' + name);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('missing value for ' + name);
    if (name === '--turn-timeout-ms') options.turnTimeoutMs = Number(value);
    else if (name === '--run-timeout-ms') options.runTimeoutMs = Number(value);
    else options[name.slice(2)] = value;
  }
  if (!options.task) throw new Error('--task path is required');
  if (!Number.isSafeInteger(options.turnTimeoutMs) || options.turnTimeoutMs < 1000 || options.turnTimeoutMs > 3600000) throw new Error('turn-timeout-ms must be 1000..3600000');
  if (!Number.isSafeInteger(options.runTimeoutMs) || options.runTimeoutMs < 1000 || options.runTimeoutMs > 7200000) throw new Error('run-timeout-ms must be 1000..7200000');
  options.cwd = resolve(options.cwd);
  options.task = resolve(options.task);
  if (options.execute && !options.out) throw new Error('--execute requires --out to preserve in-progress agent IDs');
  if (options.out) {
    options.out = resolve(options.out);
    if (!outside(options.cwd, options.out)) throw new Error('--out must be outside tested checkout');
  }
  return options;
}

function reserveJournal(out, cwd) {
  mkdirSync(dirname(out), { recursive: true });
  // Prevent an output directory symlink routing a nominally external path inside the checkout.
  if (!outside(realpathSync(cwd), realpathSync(dirname(out)))) throw new Error('--out resolves inside checkout through a symlink');
  const fd = openSync(out, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify({ status: 'reserved', createdAt: new Date().toISOString() }) + '\n'); }
  finally { closeSync(fd); }
  return state => {
    const tmp = out + '.write-' + randomUUID();
    try {
      writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      renameSync(tmp, out);
    } catch (error) {
      // A failed journal write is not silently ignored.
      try { unlinkSync(tmp); } catch {}
      throw error;
    }
  };
}


export async function main(args, loadSdk = () => import('@getpaseo/client')) {
  const opts = parseArgs(args);
  const task = validateTask(JSON.parse(readFileSync(opts.task, 'utf8')));
  if (!opts.execute) {
    console.log(JSON.stringify({ dryRun: true, taskId: task.id, cwd: opts.cwd, sol: solConfig(), worker: workerConfig(), checks: task.checks,
      maxDiffChars: DIFF_MAX, warning: 'No models called; --execute explicitly opts into paid calls. Native token totals are NOT measured by this runner.' }, null, 2));
    return 0;
  }
  const writeJournal = reserveJournal(opts.out, opts.cwd); // Must precede any paid call.
  const controller = new AbortController();
  const stop = name => controller.abort(new Error(name));
  const sigInt = () => stop('SIGINT');
  const sigTerm = () => stop('SIGTERM');
  process.once('SIGINT', sigInt);
  process.once('SIGTERM', sigTerm);
  const started = Date.now();
  const fullTimer = setTimeout(() => stop('whole-run timeout'), opts.runTimeoutMs);
  let client, result, latest = { status: 'reserved', taskId: task.id };
  const persist = state => { latest = state; writeJournal(state); };
  try {
    const { createPaseoClient } = await bounded(loadSdk(), 15000, 'SDK import', controller.signal);
    client = createPaseoClient({ url: process.env.PASEO_URL || 'ws://127.0.0.1:6767/ws',
      reconnect: { enabled: false }, connectTimeoutMs: 15000,
      ...(process.env.PASEO_PASSWORD ? { password: process.env.PASEO_PASSWORD } : {}) });
    await bounded(client.connect(), 15000, 'Paseo connection', controller.signal);
    result = await runPilot({ client, cwd: opts.cwd, rawTask: task,
      ops: localOps(opts.cwd, { signal: controller.signal }),
      turnTimeoutMs: opts.turnTimeoutMs, runTimeoutMs: Math.max(1000, opts.runTimeoutMs - (Date.now() - started)),
      signal: controller.signal, onUpdate: persist });
  } catch (error) {
    result = { ...latest, status: 'blocked', error: String(error?.message ?? error), finishedAt: new Date().toISOString(),
      note: 'Review the journal and Paseo for untracked or late-created agents before retrying.' };
  } finally {
    clearTimeout(fullTimer);
    process.removeListener('SIGINT', sigInt);
    process.removeListener('SIGTERM', sigTerm);
    if (client) {
      try { await bounded(client.close(), 10000, 'Paseo close'); }
      catch (error) { result ??= { status: 'blocked' }; result.closeError = String(error?.message ?? error); }
    }
    writeJournal(result ?? { status: 'blocked', error: 'run stopped without a result' });
  }
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'accepted' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
}
