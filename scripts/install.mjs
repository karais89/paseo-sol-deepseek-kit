import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skillName = 'paseo-sol-deepseek';
const readOptional = file => {
  try { return fs.readFileSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const equal = (a, b) => a === null ? b === null : b !== null && a.equals(b);
function sourceFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) return sourceFiles(path.join(dir, entry.name), relative);
    if (!entry.isFile()) throw new Error('Unexpected non-file resource in source skill.');
    return [relative];
  });
}

export function planInstall({ skillRoot, configPath, skillOnly = false, replaceSkill = false }) {
  const destination = path.resolve(skillRoot, skillName);
  const source = path.join(root, 'skills', skillName);
  const target = path.join(destination, 'SKILL.md');
  if (destination === source || destination.startsWith(source + path.sep)) throw new Error('Select an installation directory outside the source skill.');
  const changes = [];
  let blocked = false;
  for (const relative of sourceFiles(source)) {
    const file = path.join(destination, relative);
    const data = fs.readFileSync(path.join(source, relative));
    const old = readOptional(file);
    if (old !== null && !old.equals(data) && !replaceSkill) blocked = true;
    if (!equal(old, data)) changes.push({ file, before: old, after: data, kind: 'skill' });
  }
  let updatedProfileIds = [];
  if (!skillOnly) {
    const configFile = path.resolve(configPath);
    if (configFile === destination || configFile.startsWith(destination + path.sep)) throw new Error('Config and skill paths must differ.');
    const before = fs.readFileSync(configFile);
    const config = JSON.parse(before.toString('utf8').replace(/^\uFEFF/, ''));
    if (!config.daemon || typeof config.daemon !== 'object' || Array.isArray(config.daemon)) {
      throw new Error('Expected an existing Paseo daemon config; initialize Paseo first.');
    }
    const existing = config.daemon.agentProfiles ?? [];
    if (!Array.isArray(existing) || existing.some(p => !p || typeof p.id !== 'string')) {
      throw new Error('Invalid existing agentProfiles; no files changed.');
    }
    const profiles = JSON.parse(fs.readFileSync(path.join(root, 'profiles.json'), 'utf8'));
    const ids = profiles.map(p => p.id);
    if (ids.length !== 2 || new Set(ids).size !== 2 || !ids.includes('sol61-orchestrator') || !ids.includes('deepseek41-worker')) {
      throw new Error('Expected exactly the two team profiles.');
    }
    const merged = existing.map(p => profiles.find(next => next.id === p.id) ?? p);
    for (const profile of profiles) if (!existing.some(p => p.id === profile.id)) merged.push(profile);
    if (new Set(merged.map(p => p.id)).size !== merged.length) throw new Error('Duplicate profile IDs; no files changed.');
    updatedProfileIds = ids.filter(id => JSON.stringify(existing.find(p => p.id === id)) !== JSON.stringify(profiles.find(p => p.id === id)));
    if (updatedProfileIds.length) {
      config.daemon.agentProfiles = merged;
      changes.push({ file: configFile, before, after: Buffer.from(JSON.stringify(config, null, 2) + '\n'), kind: 'profiles' });
    }
  }
  for (const change of changes) {
    if (fs.existsSync(change.file) && fs.lstatSync(change.file).isSymbolicLink()) {
      throw new Error('Refusing to replace a symlinked file; select the intended target explicitly.');
    }
  }
  return { changes, blocked, updatedProfileIds, skillPath: target, skillOnly };
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.install-' + randomUUID();
  try {
    const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600;
    fs.writeFileSync(temp, data, { flag: 'wx', mode });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function applyInstall(plan, write = atomicWrite) {
  if (plan.blocked) throw new Error('Existing skill differs; review it and use --replace-skill to back up and replace packaged skill files.');
  for (const change of plan.changes) {
    if (!equal(readOptional(change.file), change.before)) throw new Error('A target changed after planning; run again.');
  }
  const applied = [], backups = [];
  try {
    for (const change of plan.changes) {
      if (!equal(readOptional(change.file), change.before)) throw new Error('A target changed during installation; run again.');
      if (change.before !== null) {
        const backup = change.file + '.backup-' + randomUUID();
        fs.writeFileSync(backup, change.before, { flag: 'wx', mode: 0o600 });
        backups.push(backup);
      }
      write(change.file, change.after);
      applied.push(change);
    }
  } catch (error) {
    for (const change of applied.reverse()) {
      if (equal(readOptional(change.file), change.after)) {
        if (change.before === null) fs.unlinkSync(change.file);
        else atomicWrite(change.file, change.before);
      }
    }
    throw new Error('Installation failed; prior writes were rolled back where unchanged. Backups retained: ' + backups.length, { cause: error });
  }
  return { appliedFiles: applied.map(c => c.kind), backups };
}

function main(args) {
  const options = {
    skillRoot: path.join(os.homedir(), '.agents', 'skills'),
    configPath: path.join(process.env.PASEO_HOME || path.join(os.homedir(), '.paseo'), 'config.json'),
  };
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--apply': apply = true; break;
      case '--replace-skill': options.replaceSkill = true; break;
      case '--skill-only': options.skillOnly = true; break;
      case '--skill-root': case '--config': {
        const key = args[i] === '--config' ? 'configPath' : 'skillRoot';
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing path for ' + args[i]);
        options[key] = args[++i]; break;
      }
      case '--help':
        console.log('node scripts/install.mjs [--apply] [--replace-skill] [--skill-only] [--skill-root PATH] [--config PATH]');
        return;
      default: throw new Error('Unknown argument: ' + args[i]);
    }
  }
  const plan = planInstall(options);
  console.log(JSON.stringify({ apply, skillPath: plan.skillPath, changes: plan.changes.map(c => c.kind), replacementRequired: plan.blocked, updatedProfileIds: plan.updatedProfileIds }, null, 2));
  if (apply) {
    console.log(JSON.stringify(applyInstall(plan), null, 2));
    console.log('Install complete. Reload Paseo config and check skill discovery before starting a task.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
