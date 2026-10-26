import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runPilot, validateTask, decisionFrom, localOps } from '../scripts/lib/pilot-core.mjs';
import { parseArgs } from '../scripts/pilot-runner.mjs';
const task = () => ({ id: 't1', goal: 'Fix this bug', acceptance: ['test pass'], checks: [['node', '--test']], protectedPaths: ['locked.md'] });
function fake({ plan = 'Plan: delegate the work.', worker = 'Changed file and tested.', review = 'DECISION: APPROVE\nEvidence adequate.', checkCodes = [0] } = {}) {
  const sol = { id: 'sol-1', waitForFinish: async () => ({ status: 'idle', lastMessage: plan }), runCalls: [],
    async run(prompt) { this.runCalls.push(prompt); return { status: 'idle', lastMessage: review }; },
    async archive() { this.archived = true; } };
  const dk = { id: 'worker-1', waitForFinish: async () => typeof worker === 'string' ? ({ status: 'idle', lastMessage: worker }) : worker,
    runCalls: [], async run(prompt) { this.runCalls.push(prompt); return { status: 'idle', lastMessage: 'Fixed check failure' }; },
    async archive() { this.archived = true; } };
  const created = [];
  const client = { agents: { async create(arg) { created.push(arg); return created.length === 1 ? sol : dk; } } };
  let checkCall = 0;
  const ops = {
    snapshot: async () => ({ dirty: false, revision: 'initial-HEAD' }),
    protectedSnapshot: async () => 'protected-stable',
    check: async commands => [{ command: commands[0], exitCode: checkCodes[Math.min(checkCall++, checkCodes.length - 1)], tail: 'verification output' }],
    evidence: async () => ({ changedFiles: ['fix.js'], diff: 'diff --git a/fix.js b/fix.js', diffHash: 'abc123' }),
  };
  return { client, ops, sol, dk, created };
}
test('minimal runner plans and reviews in one Sol session, while worker executes', async () => {
  const f = fake();
  const result = await runPilot({ client: f.client, cwd: '/sandbox', rawTask: task(), ops: f.ops });
  assert.equal(result.status, 'accepted');
  assert.deepEqual(result.agentIds, { sol: 'sol-1', worker: 'worker-1' });
  assert.equal(f.created.length, 2); assert.equal(f.sol.runCalls.length, 1);
  assert.equal(f.dk.runCalls.length, 0);
  assert.equal(f.created[0].config.options.sandbox_mode, 'read-only');
  assert.equal(f.created[1].config.provider, 'opencode/merge-gateway/deepseek/deepseek-v4.1-flash');
  assert.equal(result.solModelRequests, 'not collected; verify native provider usage');
  assert.ok(f.sol.runCalls[0].includes('Diff SHA256'));
});
test('failed independent check triggers exactly one correction on same worker ID', async () => {
  const f = fake({ checkCodes: [1, 0] }); const r = await runPilot({ client: f.client, cwd: '/sandbox', rawTask: task(), ops: f.ops });
  assert.equal(r.status, 'accepted'); assert.equal(r.workerCorrections, 1);
  assert.equal(f.dk.runCalls.length, 1); assert.equal(f.created.length, 2);
});
test('second failing independent check fails closed without Sol final call', async () => {
  const f = fake({ checkCodes: [1, 1] }); const r = await runPilot({ client: f.client, cwd: '/sandbox', rawTask: task(), ops: f.ops });
  assert.equal(r.status, 'blocked'); assert.match(r.error, /independent checks/);
  assert.equal(f.sol.runCalls.length, 0);
});
test('premature worker completion/permission cannot approve', async () => {
  const f = fake({ worker: { status: 'permission', error: 'human approval required', lastMessage: '' } });
  const r = await runPilot({ client: f.client, cwd: '/sandbox', rawTask: task(), ops: f.ops });
  assert.equal(r.status, 'blocked'); assert.match(r.error, /permission/); assert.equal(f.sol.runCalls.length, 0);
});
test('Sol reject or malformed output cannot approve', async () => {
  for (const review of ['DECISION: REJECT\nNo', 'APPROVE', 'DECISION: APPROVE SOMETIMES']) {
    const f = fake({ review }); const r = await runPilot({ client: f.client, cwd: '/sandbox', rawTask: task(), ops: f.ops });
    assert.equal(r.status, 'blocked');
  }
  assert.equal(decisionFrom('DECISION: APPROVE\nOK'), 'APPROVE');
  assert.equal(decisionFrom('DECISION: APPROVE/SO'), 'INVALID');
});
test('dirty baseline and edits by planner are blocked', async () => {
  const f = fake(); f.ops.snapshot = async () => ({ dirty: true, revision: 'head' });
  const r = await runPilot({ client: f.client, cwd: '/sandbox', rawTask: task(), ops: f.ops });
  assert.equal(r.status, 'blocked'); assert.equal(f.created.length, 0);
  const h = fake();let count = 0;h.ops.snapshot = async () => ({ dirty: ++count >= 2, revision: 'head' });
  const s = await runPilot({ client: h.client, cwd: '/sandbox', rawTask: task(), ops: h.ops });
  assert.match(s.error, /Sol planner modified/); assert.equal(h.created.length, 1);
});
test('changed diff following Sol acceptance is blocked', async () => {
  const f = fake();let i = 0;f.ops.evidence = async () => ({ changedFiles: ['fix.js'], diff: 'abc', diffHash: ++i === 1 ? 'before' : 'after' });
  const r = await runPilot({ client: f.client, cwd: '/sandbox', rawTask: task(), ops: f.ops });
  assert.equal(r.status, 'blocked'); assert.match(r.error, /checkout changed/);
});
test('timeout archives owned agents instead of leaving spend running', async () => {
  const f = fake({ worker: { status: 'timeout', error: 'deadline' } });
  const r = await runPilot({ client: f.client, cwd: '/sandbox', rawTask: task(), ops: f.ops });
  assert.equal(r.status, 'blocked'); assert.equal(f.dk.archived, true); assert.equal(f.sol.archived, true);
});
test('invalid or dangerous task arguments rejected before model calls', () => {
  assert.throws(() => validateTask({ ...task(), checks: [['bash', '-lc', '']] }), /nonempty/);
  assert.throws(() => validateTask({ ...task(), protectedPaths: ['../secret'] }), /within repository/);
  assert.throws(() => validateTask({ ...task(), checks: [] }), /checks/);
  assert.throws(() => parseArgs(['--task', 'sample.json', '--turn-timeout-ms', '0']), /turn-timeout/);
  assert.throws(() => parseArgs(['--cwd', '/tmp/task', '--task', '/tmp/spec.json', '--out', '/tmp/task/result.json']), /outside tested checkout/);
});
test('local git evidence captures tracked and untracked files, refuses protected changes', async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'paseo-pilot-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const cmd = (...args) => execFileSync('git', args, { cwd });
  cmd('init', '-q'); cmd('config', 'user.name', 'CI'); cmd('config', 'user.email', 'ci@example.invalid');
  writeFileSync(join(cwd, 'file.txt'), 'before\n'); cmd('add', '.'); cmd('commit', '-qm', 'initial');
  const ops = localOps(cwd);
  assert.equal((await ops.snapshot()).dirty, false);
  writeFileSync(join(cwd, 'file.txt'), 'after\n'); writeFileSync(join(cwd, 'new.txt'), 'new source\n');
  const ev = await ops.evidence(['locked.md'], 12000);
  assert.deepEqual(ev.changedFiles.sort(), ['file.txt', 'new.txt']);
  assert.match(ev.diff, /new source/); assert.match(ev.diff, /\+after/);
  assert.equal((await ops.snapshot()).dirty, true);
  await assert.rejects(ops.evidence(['new.txt'], 12000), /protected path changed/);
  await assert.rejects(ops.evidence([], 12), /diff exceeds/);
});
test('local checks run exact argv without a shell', async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'paseo-pilot-check-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const r = await localOps(cwd).check([['node', '-e', 'process.exit(0)'], ['node', '-e', 'process.exit(4)']]);
  assert.deepEqual(r.map(x => x.exitCode), [0, 4]);
});
