import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
function integer(x,n){if(!Number.isSafeInteger(x)||x<0)throw Error(n+' must be non-negative integer');return x}
function text(x,n){if(typeof x!=='string'||!x.trim())throw Error(n+' is required');return x}
function usage(x,n){
 if(!x||typeof x!=='object')throw Error(n+' usage missing');
 const a=integer(x.inputTokens,n+'.inputTokens'),b=integer(x.cachedInputTokens,n+'.cachedInputTokens'),c=integer(x.outputTokens,n+'.outputTokens');
 if(b>a||!Number.isSafeInteger(a+c))throw Error(n+' invalid cached/total tokens');
 return {total:a+c,cached:b,noncached:a-b}
}
function run(x,n,team){
 for(const k of ['taskId','conditionsId','startRevision','checkEvidence','usageEvidence'])text(x?.[k],n+'.'+k);
 if(x.passed!==true||x.usageComplete!==true)throw Error(n+' incomplete quality/usage; comparison invalid');
 if(integer(x.elapsedMs,n+'.elapsedMs')===0)throw Error(n+' zero time');
 const sol=usage(x.sol,n+'.sol');
 if(!Array.isArray(x.workers)||(team?x.workers.length===0:x.workers.length!==0))throw Error(n+' worker usage invalid');
 const workers=x.workers.map((w,i)=>{text(w.model,n+'.worker.model');return usage(w,n+'.worker'+i)});
 if(team){
  const h=x.handoff;
  if(!h||h.workerCompleted!==true||h.notificationDelivered!==true||h.sameSolSession!==true||h.solRequestsWhileWaiting!==0)throw Error('handoff not verified');
  text(h.evidence,'handoff.evidence');
 }
 return {sol,workers};
}
const round=x=>Math.round(x*100)/100;
const pctSaved=(a,b)=>100*(a-b)/a;
const pctSlower=(a,b)=>100*(b-a)/a;
const safeSum=(values,label)=>values.reduce((sum,value)=>{const next=sum+value;if(!Number.isSafeInteger(next))throw Error(label+' exceeds safe integer range');return next},0);
export function compareRuns(a,b){
 const x=run(a,'baseline',false),y=run(b,'delegated',true);
 for(const k of ['taskId','conditionsId','startRevision'])if(a[k]!==b[k])throw Error(k+' mismatch; not comparable');
 if(x.sol.total===0)throw Error('baseline Sol tokens zero');
 const reduction=round(100*(x.sol.total-y.sol.total)/x.sol.total);
 const slowdown=round(100*(b.elapsedMs-a.elapsedMs)/a.elapsedMs);
 return {taskId:a.taskId,conditionsId:a.conditionsId,startRevision:a.startRevision,qualityPassed:true,handoffPassed:true,
 sol:{baselineTokens:x.sol.total,delegatedTokens:y.sol.total,reductionPercent:reduction,baselineCachedInput:x.sol.cached,delegatedCachedInput:y.sol.cached,baselineNoncachedInput:x.sol.noncached,delegatedNoncachedInput:y.sol.noncached},
 workerTotalTokens:safeSum(y.workers.map(v=>v.total),'worker tokens'),baselineElapsedMs:a.elapsedMs,delegatedElapsedMs:b.elapsedMs,timeRegressionPercent:slowdown};
}
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
export function summarizePairs(pairs,criteria={}){
 if(!Array.isArray(pairs)||!pairs.length)throw Error('no pairs');
 const limits={minPairs:6,minTasks:3,minTrialsPerTask:2,minSolReductionPercent:30,minAggregateSolReductionPercent:30,maxTimeRegressionPercent:25,maxAggregateTimeRegressionPercent:25,maxTaskTimeRegressionPercent:100,...criteria};
 const countLimits=['minPairs','minTasks','minTrialsPerTask'];
 const percentLimits=['minSolReductionPercent','minAggregateSolReductionPercent','maxTimeRegressionPercent','maxAggregateTimeRegressionPercent','maxTaskTimeRegressionPercent'];
 for(const name of Object.keys(criteria))if(![...countLimits,...percentLimits].includes(name))throw Error('unknown criterion '+name);
 for(const name of countLimits)if(!Number.isSafeInteger(limits[name])||limits[name]<1)throw Error('invalid '+name);
 for(const name of percentLimits)if(typeof limits[name]!=='number'||!Number.isFinite(limits[name])||limits[name]<0)throw Error('invalid '+name);
 for(const name of ['minSolReductionPercent','minAggregateSolReductionPercent'])if(limits[name]>100)throw Error('invalid '+name);
 const results=pairs.map((pair,i)=>{if(!Array.isArray(pair)||pair.length!==2)throw Error('invalid pair '+i);return compareRuns(pair[0],pair[1])});
 const keys=results.map(r=>JSON.stringify([r.taskId,r.conditionsId]));
 if(new Set(keys).size!==keys.length)throw Error('duplicate trial');
 const byTask=new Map();
 for(const r of results){const rows=byTask.get(r.taskId)||[];rows.push(r);byTask.set(r.taskId,rows)}
 const sum=(rows,key,label)=>safeSum(rows.map(key),label);
 const metrics=(rows)=>({
   baselineTokens:sum(rows,r=>r.sol.baselineTokens,'Sol baseline tokens'),
   delegatedTokens:sum(rows,r=>r.sol.delegatedTokens,'Sol delegated tokens'),
   baselineElapsedMs:sum(rows,r=>r.baselineElapsedMs,'baseline time'),
   delegatedElapsedMs:sum(rows,r=>r.delegatedElapsedMs,'delegated time')
 });
 const totals=metrics(results);
 const medianSolRaw=median(results.map(r=>pctSaved(r.sol.baselineTokens,r.sol.delegatedTokens)));
 const medianTimeRaw=median(results.map(r=>pctSlower(r.baselineElapsedMs,r.delegatedElapsedMs)));
 const aggregateSolRaw=pctSaved(totals.baselineTokens,totals.delegatedTokens);
 const aggregateTimeRaw=pctSlower(totals.baselineElapsedMs,totals.delegatedElapsedMs);
 const groups=[...byTask].map(([taskId,rows])=>{
   const total=metrics(rows),timeRaw=pctSlower(total.baselineElapsedMs,total.delegatedElapsedMs);
   return {taskId,rows:rows.length,...total,solReductionPercent:round(pctSaved(total.baselineTokens,total.delegatedTokens)),timeRegressionPercent:round(timeRaw),timeRaw};
 });
 const failures=[];
 if(results.length<limits.minPairs)failures.push('not enough pairs');
 if(groups.length<limits.minTasks)failures.push('not enough tasks');
 if(groups.some(g=>g.rows<limits.minTrialsPerTask))failures.push('not enough trials per task');
 // All decisions use unrounded counts and ratios; rounding is presentation-only.
 if(medianSolRaw<limits.minSolReductionPercent)failures.push('Sol median reduction below threshold');
 if(totals.delegatedTokens>=totals.baselineTokens||aggregateSolRaw<limits.minAggregateSolReductionPercent)failures.push('Sol aggregate reduction below threshold');
 if(medianTimeRaw>limits.maxTimeRegressionPercent)failures.push('median time regression above threshold');
 if(aggregateTimeRaw>limits.maxAggregateTimeRegressionPercent)failures.push('aggregate time regression above threshold');
 if(groups.some(g=>g.timeRaw>limits.maxTaskTimeRegressionPercent))failures.push('per-task time regression above threshold');
 return {pairCount:results.length,taskCount:groups.length,criteria:limits,
   totalSol:{baselineTokens:totals.baselineTokens,delegatedTokens:totals.delegatedTokens},
   totalElapsedMs:{baseline:totals.baselineElapsedMs,delegated:totals.delegatedElapsedMs},
   medianSolReductionPercent:round(medianSolRaw),aggregateSolReductionPercent:round(aggregateSolRaw),
   medianTimeRegressionPercent:round(medianTimeRaw),aggregateTimeRegressionPercent:round(aggregateTimeRaw),
   gatePassed:failures.length===0,gateFailures:failures,
   tasks:groups.map(({timeRaw,...item})=>item),pairs:results};
}
function main(args){
 let json=false,gate=false;const files=[],criteria={};
 const flags={'--min-pairs':'minPairs','--min-tasks':'minTasks','--min-trials-per-task':'minTrialsPerTask','--min-sol-reduction':'minSolReductionPercent','--min-aggregate-sol-reduction':'minAggregateSolReductionPercent','--max-time-regression':'maxTimeRegressionPercent','--max-aggregate-time-regression':'maxAggregateTimeRegressionPercent','--max-task-time-regression':'maxTaskTimeRegressionPercent'};
 for(const arg of args){if(arg==='--json')json=true;else if(arg==='--gate')gate=true;else if(arg.startsWith('--')){
  const [key,value]=arg.split('=');if(!(key in flags)||!value||!value.trim())throw Error('invalid option '+arg);criteria[flags[key]]=Number(value);
 }else files.push(arg)}
 if(files.length<2||files.length%2)throw Error('expected baseline.json delegated.json pairs');
 const pairs=[];for(let i=0;i<files.length;i+=2)pairs.push([JSON.parse(fs.readFileSync(files[i],'utf8')),JSON.parse(fs.readFileSync(files[i+1],'utf8'))]);
 const result=summarizePairs(pairs,criteria);
 console.log(json?JSON.stringify(result,null,2):'Sol median/aggregate reduction '+result.medianSolReductionPercent+'%/'+result.aggregateSolReductionPercent+'%, time median/aggregate regression '+result.medianTimeRegressionPercent+'%/'+result.aggregateTimeRegressionPercent+'%, gate '+(result.gatePassed?'PASS':'NOT READY')+' '+result.gateFailures.join('; '));
 if(gate&&!result.gatePassed)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)try{main(process.argv.slice(2))}catch(e){console.error(e.message);process.exitCode=2}
