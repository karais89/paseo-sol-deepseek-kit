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
export function compareRuns(a,b){
 const x=run(a,'baseline',false),y=run(b,'delegated',true);
 for(const k of ['taskId','conditionsId','startRevision'])if(a[k]!==b[k])throw Error(k+' mismatch; not comparable');
 if(x.sol.total===0)throw Error('baseline Sol tokens zero');
 const reduction=round(100*(x.sol.total-y.sol.total)/x.sol.total);
 const slowdown=round(100*(b.elapsedMs-a.elapsedMs)/a.elapsedMs);
 return {taskId:a.taskId,conditionsId:a.conditionsId,startRevision:a.startRevision,qualityPassed:true,handoffPassed:true,
 sol:{baselineTokens:x.sol.total,delegatedTokens:y.sol.total,reductionPercent:reduction,baselineCachedInput:x.sol.cached,delegatedCachedInput:y.sol.cached,baselineNoncachedInput:x.sol.noncached,delegatedNoncachedInput:y.sol.noncached},
 workerTotalTokens:y.workers.reduce((t,v)=>t+v.total,0),baselineElapsedMs:a.elapsedMs,delegatedElapsedMs:b.elapsedMs,timeRegressionPercent:slowdown};
}
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
export function summarizePairs(pairs,criteria={}){
 if(!Array.isArray(pairs)||!pairs.length)throw Error('no pairs');
 const limits={minPairs:6,minTasks:3,minSolReductionPercent:30,maxTimeRegressionPercent:25,...criteria};
 for(const k of ['minPairs','minTasks'])if(!Number.isSafeInteger(limits[k])||limits[k]<1)throw Error('invalid '+k);
 for(const k of ['minSolReductionPercent','maxTimeRegressionPercent'])if(!Number.isFinite(limits[k]))throw Error('invalid '+k);
 const results=pairs.map(([a,b])=>compareRuns(a,b));
 const keys=results.map(r=>r.taskId+'|'+r.conditionsId);
 if(new Set(keys).size!==keys.length)throw Error('duplicate trial');
 const taskCount=new Set(results.map(r=>r.taskId)).size;
 const sol=round(median(results.map(r=>r.sol.reductionPercent)));
 const time=round(median(results.map(r=>r.timeRegressionPercent)));
 const failures=[];
 if(results.length<limits.minPairs)failures.push('not enough pairs');
 if(taskCount<limits.minTasks)failures.push('not enough tasks');
 if(sol<limits.minSolReductionPercent)failures.push('Sol reduction below threshold');
 if(time>limits.maxTimeRegressionPercent)failures.push('time regression above threshold');
 return {pairCount:results.length,taskCount,medianSolReductionPercent:sol,medianTimeRegressionPercent:time,gatePassed:failures.length===0,gateFailures:failures,pairs:results};
}
function main(args){
 let json=false,gate=false;const files=[],criteria={};
 const flags={'--min-pairs':'minPairs','--min-tasks':'minTasks','--min-sol-reduction':'minSolReductionPercent','--max-time-regression':'maxTimeRegressionPercent'};
 for(const arg of args){if(arg==='--json')json=true;else if(arg==='--gate')gate=true;else if(arg.startsWith('--')){
  const [key,value]=arg.split('=');if(!(key in flags)||!value||!value.trim())throw Error('invalid option '+arg);criteria[flags[key]]=Number(value);
 }else files.push(arg)}
 if(files.length<2||files.length%2)throw Error('expected baseline.json delegated.json pairs');
 const pairs=[];for(let i=0;i<files.length;i+=2)pairs.push([JSON.parse(fs.readFileSync(files[i],'utf8')),JSON.parse(fs.readFileSync(files[i+1],'utf8'))]);
 const result=summarizePairs(pairs,criteria);
 console.log(json?JSON.stringify(result,null,2):'Sol median reduction '+result.medianSolReductionPercent+'%, time regression '+result.medianTimeRegressionPercent+'%, gate '+(result.gatePassed?'PASS':'NOT READY')+' '+result.gateFailures.join('; '));
 if(gate&&!result.gatePassed)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)try{main(process.argv.slice(2))}catch(e){console.error(e.message);process.exitCode=2}
