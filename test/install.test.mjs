import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planInstall, applyInstall } from '../scripts/install.mjs';

function fixture(t) {
  const tempRoot = fileURLToPath(new URL('../.local/', import.meta.url));
  fs.mkdirSync(tempRoot, { recursive: true });
  const prefix = path.resolve(tempRoot, 'paseo-kit-test-');
  const root = fs.mkdtempSync(prefix);
  assert.ok(path.resolve(root).startsWith(prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config.json');
  const skillRoot = path.join(root, 'skills');
  const config = { daemon: { appendSystemPrompt: 'Keep existing instructions', agentProfiles: [{ id: 'other', provider: 'other', notes: 'preserve' }] }, custom: { keep: true } };
  fs.writeFileSync(configPath, JSON.stringify(config));
  return { root, configPath, skillRoot, config };
}

test('dry run writes nothing; apply preserves other config and profiles; repeated apply is empty', t => {
  const f = fixture(t), before = fs.readFileSync(f.configPath);
  const plan = planInstall(f);
  assert.equal(fs.existsSync(f.skillRoot), false);
  assert.deepEqual(fs.readFileSync(f.configPath), before);
  const result = applyInstall(plan);
  const after = JSON.parse(fs.readFileSync(f.configPath));
  assert.deepEqual(after.custom, f.config.custom);
  assert.equal(after.daemon.appendSystemPrompt, f.config.daemon.appendSystemPrompt);
  assert.deepEqual(after.daemon.agentProfiles[0], f.config.daemon.agentProfiles[0]);
  assert.equal(after.daemon.agentProfiles.length, 3);
  assert.equal(result.backups.length, 1);
  assert.deepEqual(fs.readFileSync(result.backups[0]), before);
  assert.deepEqual(applyInstall(planInstall(f)).appliedFiles, []);
});

test('existing skill requires explicit replacement, backs up bytes, and preserves other resources', t => {
  const f = fixture(t), file = path.join(f.skillRoot, 'paseo-sol-deepseek', 'SKILL.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'Existing user skill');
  const notes = path.join(path.dirname(file), 'personal.txt');
  fs.writeFileSync(notes, 'Preserve');
  const before = fs.readFileSync(f.configPath);
  assert.throws(() => applyInstall(planInstall(f)), /Existing skill differs/);
  assert.deepEqual(fs.readFileSync(f.configPath), before);
  const result = applyInstall(planInstall({ ...f, replaceSkill: true }));
  assert.equal(fs.readFileSync(result.backups[0], 'utf8'), 'Existing user skill');
  assert.equal(fs.readFileSync(notes, 'utf8'), 'Preserve');
});

test('stale plan cannot overwrite a concurrent config edit or install the skill', t => {
  const f = fixture(t), plan = planInstall(f);
  fs.writeFileSync(f.configPath, '{"concurrent":true}');
  assert.throws(() => applyInstall(plan), /changed after planning/);
  assert.equal(fs.existsSync(f.skillRoot), false);
  assert.equal(fs.readFileSync(f.configPath, 'utf8'), '{"concurrent":true}');
});

test('later failure rolls back the installed skill and preserves original config', t => {
  const f = fixture(t), before = fs.readFileSync(f.configPath), plan = planInstall(f);
  let writes = 0;
  assert.throws(() => applyInstall(plan, (file, data) => {
    if (++writes === plan.changes.length) throw new Error('Injected write failure');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data);
  }), /rolled back/);
  assert.equal(fs.existsSync(plan.skillPath), false);
  assert.deepEqual(fs.readFileSync(f.configPath), before);
});

test('skill-only install needs no Paseo config', t => {
  const f = fixture(t); fs.unlinkSync(f.configPath);
  const plan = planInstall({ ...f, skillOnly: true });
  applyInstall(plan);
  assert.ok(fs.existsSync(plan.skillPath));
  assert.equal(fs.existsSync(f.configPath), false);
});

test('invalid and duplicate existing profiles are rejected before writes', t => {
  const f = fixture(t);
  for (const value of [{}, [{ id: 'same' }, { id: 'same' }], [null]]) {
    fs.writeFileSync(f.configPath, JSON.stringify({ daemon: { agentProfiles: value } }));
    assert.throws(() => planInstall(f), /Invalid existing|Duplicate profile/);
    assert.equal(fs.existsSync(f.skillRoot), false);
  }
});


test('skill-only install copies the pre-merge guide at its referenced path',t=>{
  const f=fixture(t);applyInstall(planInstall({...f,skillOnly:true}));
  const base=path.join(f.skillRoot,'paseo-sol-deepseek');
  const skill=fs.readFileSync(path.join(base,'SKILL.md'),'utf8');
  assert.match(skill,/references\/pre-merge-validation\.md/);
  const guide=fs.readFileSync(path.join(base,'references','pre-merge-validation.md'),'utf8');
  assert.match(guide,/Sol/);
});
