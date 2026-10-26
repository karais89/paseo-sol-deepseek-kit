import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runPilot, validateTask, localOps, DIFF_MAX } from '../scripts/lib/pilot-core.mjs';
import { parseArgs, main } from '../scripts/pilot-runner.mjs';

function repo(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'paseo-adversarial-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'ci@example.invalid'); git('config', 'user.name', 'CI');
  writeFileSync(join(cwd, 'src.js'), 'before\n');
  git('add', '.'); git('commit', '-qm', 'baseline');
  return { cwd, git };
}
function task(overrides={}) {
  return { id: 'adversarial', goal: 'Implement correct behavior', acceptance: ['Check passes'],
    checks: [['node', '-e', 'process.exit(0)']], protectedPaths: [], ...overrides };
}
function fakeSdk({ checker } = {}) {
  const sol = { id: 'sol-test', archived: false,
    waitForFinish: async () => ({ status: 'idle', lastMessage: 'Apply simple fix' }),
    run: async () => ({ status: 'idle', lastMessage: 'DECISION: APPROVE\nVerified evidence' }),
    archive: async function () { this.archived = true; } };
  const worker = { id: 'worker-test', archived: false,
    waitForFinish: async () => ({ status: 'idle', lastMessage: 'Implemented and tested' }),
    run: async () => ({ status: 'idle', lastMessage: 'Fixed check' }),
    archive: async function () { this.archived = true; } };
  const client = { agents: { create: async ({ config }) => config.provider.startsWith('codex/') ? sol : worker } };
  const ops = checker ?? { snapshot: async () => ({ dirty: false, revision: 'abc' }),
    protectedSnapshot: async () => 'same',
    check: async cmds => cmds.map(command => ({ command, exitCode: 0, tail: 'OK' })),
    evidence: async () => ({ changedFiles: ['src.js'], diff: 'diff --git a/src.js b/src.js', diffHash: 'hash' }) };
  return { client, ops, sol, worker };
}

test('textconv cannot hide changes or run an external converter', async t => {
  const r = repo(t);
  writeFileSync(join(r.cwd, '.gitattributes'), 'src.js diff=hide\n');
  r.git('add', '.gitattributes'); r.git('commit', '-qm', 'attributes');
  r.git('config', 'diff.hide.textconv', 'nonexistent-converter-must-not-run');
  writeFileSync(join(r.cwd, 'src.js'), 'after\n');
  const ev = await localOps(r.cwd).evidence([], DIFF_MAX);
  assert.deepEqual(ev.changedFiles, ['src.js']);
  assert.match(ev.diff, /\+after/);
  assert.ok(ev.diffHash);
  writeFileSync(join(r.cwd, 'src.js'), 'different after\n');
  assert.notEqual((await localOps(r.cwd).evidence([], DIFF_MAX)).diffHash, ev.diffHash);
});

test('normalized protected path, ignored file and explicit Git config are fingerprinted', async t => {
  const r = repo(t);
  assert.deepEqual(validateTask(task({ protectedPaths: ['./locked.md', 'dir/./file.txt'] })).protectedPaths, ['locked.md', 'dir/file.txt']);
  assert.throws(() => validateTask(task({ protectedPaths: ['.git'] })), /unsupported/);
  writeFileSync(join(r.cwd, '.gitignore'), 'locked.md\n');
  writeFileSync(join(r.cwd, 'locked.md'), 'sensitive\n');
  const ops = localOps(r.cwd);
  const before = await ops.protectedSnapshot(['locked.md', '.git/config']);
  writeFileSync(join(r.cwd, 'locked.md'), 'changed ignored file\n');
  assert.notEqual(await ops.protectedSnapshot(['locked.md', '.git/config']), before);
  assert.equal((await ops.snapshot()).dirty, true); // .gitignore not yet committed
  r.git('add', '.gitignore'); r.git('commit', '-qm', 'ignore');
  assert.equal((await ops.snapshot()).dirty, false); // ignored file is invisible to Git
  const second = await ops.protectedSnapshot(['locked.md', '.git/config']);
  r.git('config', 'demo.token', 'modified');
  assert.notEqual(await ops.protectedSnapshot(['locked.md', '.git/config']), second);
});

test('protected directory inventory includes new files and deletes', async t => {
  const r = repo(t);
  mkdirSync(join(r.cwd, 'protected'));
  writeFileSync(join(r.cwd, 'protected', 'a.txt'), 'value');
  const ops = localOps(r.cwd);
  const before = await ops.protectedSnapshot(['protected']);
  writeFileSync(join(r.cwd, 'protected', 'new.txt'), 'add');
  assert.notEqual(await ops.protectedSnapshot(['protected']), before);
});

test('tracked binary refuses automated approval', async t => {
  const r = repo(t);
  writeFileSync(join(r.cwd, 'file.bin'), Buffer.from([0,1,2])); r.git('add', 'file.bin'); r.git('commit', '-qm', 'binary');
  writeFileSync(join(r.cwd, 'file.bin'), Buffer.from([0,1,3]));
  await assert.rejects(localOps(r.cwd).evidence([], DIFF_MAX), /tracked binary|binary change/i);
});

test('known 23KB submission size fits the predeclared bounded review', async t => {
  const r = repo(t);
  writeFileSync(join(r.cwd, 'big.txt'), 'A'.repeat(23319));
  const result = await localOps(r.cwd).evidence([], DIFF_MAX);
  assert.equal(result.changedFiles.length, 1);
  assert.ok(result.diff.length > 23000);
  assert.ok(result.diff.length < DIFF_MAX);
});

test('empty/mismatched independent check evidence never approves', async () => {
  const f = fakeSdk();f.ops.check=async()=>[];
  const a=await runPilot({client:f.client,cwd:'/fake',rawTask:task(),ops:f.ops});
  assert.equal(a.status,'blocked');assert.match(a.error,/evidence count mismatch/);
  assert.equal(f.sol.archived,true);assert.equal(f.worker.archived,true);
  const g=fakeSdk();g.ops.check=async()=>[{command:['node','-e','wrong'],exitCode:0,tail:'OK'}];
  const b=await runPilot({client:g.client,cwd:'/fake',rawTask:task(),ops:g.ops});
  assert.equal(b.status,'blocked');assert.match(b.error,/evidence mismatch/);
});

test('SDK thrown errors and permission responses archive all known owned agents', async () => {
  const f=fakeSdk();f.worker.waitForFinish=async()=>{throw new Error('SDK disconnected');};
  const result=await runPilot({client:f.client,cwd:'/fake',rawTask:task(),ops:f.ops});
  assert.equal(result.status,'blocked');assert.match(result.error,/SDK disconnected/);
  assert.equal(f.sol.archived,true);assert.equal(f.worker.archived,true);
  const g=fakeSdk();g.worker.waitForFinish=async()=>({status:'permission',error:'approval required'});
  const second=await runPilot({client:g.client,cwd:'/fake',rawTask:task(),ops:g.ops});
  assert.equal(second.status,'blocked');assert.equal(g.worker.archived,true);
});

test('aborted creation is bounded, with late-created agent archived', async () => {
  const controller=new AbortController();let resolveCreation;
  const sol={ id:'late-sol', archived:false, archive:async function(){this.archived=true;} };
  const client={agents:{create:()=>new Promise(resolve=>{resolveCreation=resolve;})}};
  const f=fakeSdk();
  const run=runPilot({client,cwd:'/fake',rawTask:task(),ops:f.ops,signal:controller.signal});
  await new Promise(resolve=>setTimeout(resolve,20));controller.abort();
  const r=await run;assert.equal(r.status,'blocked');assert.match(r.error,/aborted/);
  resolveCreation(sol);await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(sol.archived,true);
});

test('changed protected content blocks before Sol review despite passing checks', async () => {
  const f=fakeSdk();let n=0;
  f.ops.protectedSnapshot=async()=>++n===1?'before':'after';
  let reviews=0;f.sol.run=async()=>{reviews++;return {status:'idle',lastMessage:'DECISION: APPROVE'};};
  const r=await runPilot({client:f.client,cwd:'/fake',rawTask:task({protectedPaths:['./locked.md']}),ops:f.ops});
  assert.equal(r.status,'blocked');assert.match(r.error,/protected path/);
  assert.equal(reviews,0);
});

test('output path ..inside is rejected and execute requires journal', () => {
  const cwd=join(tmpdir(),'test-cwd');
  assert.throws(()=>parseArgs(['--cwd',cwd,'--task','spec.json','--out',join(cwd,'..inside','out.json')]), /outside/);
  assert.throws(()=>parseArgs(['--cwd',cwd,'--task','spec.json','--execute']), /requires --out/);
  assert.doesNotThrow(()=>parseArgs(['--cwd',cwd,'--task','spec.json','--out',join(tmpdir(),'outside','out.json')]));
});

test('existing output file aborts before loading the paid SDK', async t => {
  const r=repo(t),outside=mkdtempSync(join(tmpdir(),'paseo-result-'));
  t.after(()=>rmSync(outside,{recursive:true,force:true}));
  const spec=join(outside,'task.json'),out=join(outside,'existing.json');
  writeFileSync(spec,JSON.stringify(task()));writeFileSync(out,'prior run');
  let loads=0;
  await assert.rejects(main(['--execute','--cwd',r.cwd,'--task',spec,'--out',out],()=>{loads++;throw new Error('should not load');}), /EEXIST/);
  assert.equal(loads,0);assert.equal(readFileSync(out,'utf8'),'prior run');
});

test('SDK connection and close errors preserve a readable failure journal', async t => {
  const r=repo(t),outside=mkdtempSync(join(tmpdir(),'paseo-result-'));
  t.after(()=>rmSync(outside,{recursive:true,force:true}));
  const spec=join(outside,'task.json'),out=join(outside,'failed.json');
  writeFileSync(spec,JSON.stringify(task()));
  const sdk=()=>({createPaseoClient:()=>({ connect:async()=>{throw new Error('connection refused');}, close:async()=>{throw new Error('close failed');} })});
  const old=console.log;console.log=()=>{};
  let code;try{code=await main(['--execute','--cwd',r.cwd,'--task',spec,'--out',out],sdk);}finally{console.log=old;}
  assert.equal(code,1);
  const result=JSON.parse(readFileSync(out,'utf8'));
  assert.equal(result.status,'blocked');assert.match(result.error,/connection refused/);assert.match(result.closeError,/close failed/);
});

test('Git common metadata protection works inside a separate worktree', async t => {
  const r=repo(t);
  const checkout=mkdtempSync(join(tmpdir(),'paseo-worktree-'));
  rmSync(checkout,{recursive:true,force:true});
  r.git('worktree','add','-q','-b','isolated',checkout);
  t.after(()=>{try{r.git('worktree','remove','-f',checkout);}catch{} rmSync(checkout,{recursive:true,force:true});});
  const ops=localOps(checkout);
  const before=await ops.protectedSnapshot(['.git/config']);
  r.git('config','foo.bar','modified');
  assert.notEqual(await ops.protectedSnapshot(['.git/config']),before);
});

test('journal stores both agent IDs before worker completion', async t => {
  const r=repo(t);
  const outside=mkdtempSync(join(tmpdir(),'paseo-journal-'));
  t.after(()=>rmSync(outside,{recursive:true,force:true}));
  const spec=join(outside,'task.json'),out=join(outside,'progress.json');
  writeFileSync(spec,JSON.stringify(task()));
  let solIdSeen=false,workerIdSeen=false;
  const sol={id:'sol-journal',async waitForFinish(){
      solIdSeen=JSON.parse(readFileSync(out,'utf8')).agentIds?.sol==='sol-journal';
      return {status:'idle',lastMessage:'Short plan'};
    },async run(){return {status:'idle',lastMessage:'DECISION: APPROVE\nEvidence good'};},async archive(){}};
  const worker={id:'worker-journal',async waitForFinish(){
      const journal=JSON.parse(readFileSync(out,'utf8'));
      workerIdSeen=journal.agentIds.sol==='sol-journal'&&journal.agentIds.worker==='worker-journal';
      return {status:'idle',lastMessage:'Changed source'};
    },async archive(){}};
  const sdk=()=>({createPaseoClient:()=>({connect:async()=>{},close:async()=>{},agents:{async create({config}){
    if(config.provider.startsWith('codex/'))return sol;
    writeFileSync(join(r.cwd,'src.js'),'after\n');return worker;
  }}})});
  const previous=console.log;console.log=()=>{};
  let code;try{code=await main(['--execute','--cwd',r.cwd,'--task',spec,'--out',out],sdk);}finally{console.log=previous;}
  const result=JSON.parse(readFileSync(out,'utf8'));
  assert.equal(code,0);assert.equal(result.status,'accepted');
  assert.equal(solIdSeen,true);assert.equal(workerIdSeen,true);
  assert.deepEqual(result.agentIds,{sol:'sol-journal',worker:'worker-journal'});
});
