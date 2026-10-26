import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareRuns,summarizePairs} from '../scripts/compare-runs.mjs';
const base=(id='a',trial='t1')=>({taskId:id,conditionsId:trial,startRevision:'abc',passed:true,checkEvidence:'test log',usageComplete:true,usageEvidence:'usage log',elapsedMs:1000,sol:{inputTokens:800,cachedInputTokens:600,outputTokens:200},workers:[]});
const team=(id='a',trial='t1')=>({...base(id,trial),elapsedMs:1200,sol:{inputTokens:250,cachedInputTokens:200,outputTokens:50},workers:[{model:'deepseek',inputTokens:4000,cachedInputTokens:0,outputTokens:1000}],handoff:{workerCompleted:true,notificationDelivered:true,sameSolSession:true,solRequestsWhileWaiting:0,evidence:'timestamp log'}});
test('count Sol cached input and workers separately',()=>{const r=compareRuns(base(),team());assert.equal(r.sol.reductionPercent,70);assert.equal(r.workerTotalTokens,5000);assert.equal(r.timeRegressionPercent,20)});
test('reject mismatched revisions',()=>{const b=team();b.startRevision='different';assert.throws(()=>compareRuns(base(),b),/not comparable/)});
test('reject incomplete quality and usage',()=>{const b=team();b.usageComplete=false;assert.throws(()=>compareRuns(base(),b),/incomplete/);b.usageComplete=true;b.passed=false;assert.throws(()=>compareRuns(base(),b),/incomplete/)});
test('reject notification and idle polling failures',()=>{const b=team();b.handoff.solRequestsWhileWaiting=1;assert.throws(()=>compareRuns(base(),b),/handoff/);b.handoff.solRequestsWhileWaiting=0;b.handoff.notificationDelivered=false;assert.throws(()=>compareRuns(base(),b),/handoff/)});
test('reject impossible cache and missing tokens',()=>{const b=team();b.sol.cachedInputTokens=251;assert.throws(()=>compareRuns(base(),b),/invalid/);b.sol.cachedInputTokens=0;delete b.sol.outputTokens;assert.throws(()=>compareRuns(base(),b),/integer/)});
test('negative savings remain regression',()=>{const b=team();b.sol={inputTokens:1200,cachedInputTokens:0,outputTokens:100};assert.equal(compareRuns(base(),b).sol.reductionPercent,-30)});
test('six pairs and three tasks pass predefined gate',()=>{const pairs=Array.from({length:6},(_,i)=>[base('task'+(i>>1),'trial'+(i%2)),team('task'+(i>>1),'trial'+(i%2))]);assert.equal(summarizePairs(pairs).gatePassed,true);assert.equal(summarizePairs(pairs.slice(0,2)).gatePassed,false);assert.equal(summarizePairs(pairs,{maxTimeRegressionPercent:10}).gatePassed,false);assert.throws(()=>summarizePairs([pairs[0],pairs[0]]),/duplicate/)});


const gateBase=(id,trial,sol=1000,ms=1000)=>({taskId:id,conditionsId:trial,startRevision:'abc',passed:true,checkEvidence:'test log',usageComplete:true,usageEvidence:'usage log',elapsedMs:ms,sol:{inputTokens:sol,cachedInputTokens:0,outputTokens:0},workers:[]});
const gateTeam=(id,trial,sol=300,ms=1200)=>({...gateBase(id,trial,sol,ms),workers:[{model:'deepseek',inputTokens:4000,cachedInputTokens:0,outputTokens:1000}],handoff:{workerCompleted:true,notificationDelivered:true,sameSolSession:true,solRequestsWhileWaiting:0,evidence:'notification log'}});
test('weighted token/time regression is NOT a PASS despite median',()=>{
 const pairs=Array.from({length:6},(_,i)=>{const big=i>=4,id='task'+(i>>1);return [gateBase(id,'r'+i,big?100000:1000,big?100000:1000),gateTeam(id,'r'+i,big?110000:300,big?200000:1200)]});
 const r=summarizePairs(pairs);
 assert.equal(r.totalSol.baselineTokens,204000);assert.equal(r.totalSol.delegatedTokens,221200);
 assert.equal(r.totalElapsedMs.baseline,204000);assert.equal(r.totalElapsedMs.delegated,404800);
 assert.equal(r.medianSolReductionPercent,70);assert.equal(r.medianTimeRegressionPercent,20);
 assert.equal(r.gatePassed,false);
 assert.ok(r.gateFailures.includes('Sol aggregate reduction below threshold'));
 assert.ok(r.gateFailures.includes('aggregate time regression above threshold'));
});
test('100x slower task is rejected even if aggregate time and median improve',()=>{
 const pairs=Array.from({length:6},(_,i)=>{const big=i>=4,id='task'+(i>>1);return [gateBase(id,'r'+i,1000,big?1000:1000000),gateTeam(id,'r'+i,300,100000)]});
 const r=summarizePairs(pairs);assert.equal(r.gatePassed,false);
 assert.ok(r.aggregateTimeRegressionPercent<25);
 assert.ok(r.gateFailures.includes('per-task time regression above threshold'));
});
test('rounding must not turn 29.996 and 25.004 into PASS',()=>{
 const pairs=Array.from({length:6},(_,i)=>{const id='task'+(i>>1);return [gateBase(id,'r'+i,100000,100000),gateTeam(id,'r'+i,70004,125004)]});
 const r=summarizePairs(pairs);assert.equal(r.medianSolReductionPercent,30);assert.equal(r.medianTimeRegressionPercent,25);
 assert.equal(r.gatePassed,false);
 assert.ok(r.gateFailures.includes('Sol median reduction below threshold'));
 assert.ok(r.gateFailures.includes('Sol aggregate reduction below threshold'));
 assert.ok(r.gateFailures.includes('median time regression above threshold'));
 assert.ok(r.gateFailures.includes('aggregate time regression above threshold'));
});
test('at least two repetitions per task are required',()=>{
 const pairs=Array.from({length:6},(_,i)=>{const id=i<4?'a':i===4?'b':'c';return [gateBase(id,'r'+i),gateTeam(id,'r'+i)]});
 const r=summarizePairs(pairs);assert.equal(r.pairCount,6);assert.equal(r.taskCount,3);assert.equal(r.gatePassed,false);
 assert.ok(r.gateFailures.includes('not enough trials per task'));
});
test('aggregate totals exceeding safe integer range are rejected',()=>{
 const pairs=Array.from({length:6},(_,i)=>{const id='task'+(i>>1);return [gateBase(id,'r'+i,Number.MAX_SAFE_INTEGER,1000),gateTeam(id,'r'+i)]});
 assert.throws(()=>summarizePairs(pairs),/safe integer range/);
});
test('invalid new thresholds are rejected',()=>{
 const pairs=Array.from({length:6},(_,i)=>{const id='task'+(i>>1);return [gateBase(id,'r'+i),gateTeam(id,'r'+i)]});
 assert.throws(()=>summarizePairs(pairs,{maxTaskTimeRegressionPercent:-1}),/invalid/);
 assert.throws(()=>summarizePairs(pairs,{whatIsThis:1}),/unknown criterion/);
});
