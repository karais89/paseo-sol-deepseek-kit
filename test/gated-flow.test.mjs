import {test} from 'node:test';
import assert from 'node:assert/strict';
import gatedFlow from '../skills/paseo-sol-deepseek/scripts/gated_flow.cjs';

const accept={action:'accept',summary:'Reviewed against contract',defects:[]};
const correction={action:'correct',summary:'Concrete defect',defects:[{requirement:'exact cents',expected:'integer cents',observed:'float conversion in patch'}]};
function fixture(options={}){
  const state=new Map(),calls=[],contexts=[];
  const packet={status:'REVIEW_READY',agentId:'worker',review:{base:'base',head:'base',protectedChanges:[],diffCheck:{exitCode:0},independentTests:{exitCode:0,requestedCommand:'required command'},trackedPatch:'REAL PATCH',newFiles:[]},...options.packet};
  if(options.review)packet.review={...packet.review,...options.review};
  const workerSource=`module.exports=async function(runtime,options){runtime.tools.recordWorker(options);runtime.store('paseoInlineTeam',{agentId:'worker',task:{cwd:'/private/tmp/candidate',taskText:'ORIGINAL CONTRACT',initialStatus:''}});return runtime.tools.packet;};`;
  const tools={packet,recordWorker:opts=>calls.push({kind:'worker',action:opts.action,options:opts}),
    async exec_command(args){
      if(args.cmd.includes('--preflight')){calls.push({kind:'admission'});return {exit_code:options.admissionFailure?2:0,output:JSON.stringify({status:'PASS',advertisedTools:[]})};}
      if(args.cmd.includes('mkdir(mode'))return {exit_code:options.existingDir?1:0,output:''};
      if(args.cmd.startsWith('cat '))return {exit_code:0,output:workerSource};
      if(args.cmd.includes('--input')){
        const round=calls.filter(x=>x.kind==='judge').length;calls.push({kind:'judge',args});
        const value=(options.decisions??[accept])[round]??accept;
        return {exit_code:0,output:JSON.stringify({status:'REVIEW_DECISION',threadId:round&&options.changedThread?'other-thread':'same-thread',decision:value,usage:{input_tokens:20,cached_input_tokens:0,output_tokens:10},accounting:'COMPLETE_TURN_COUNTERS'})};
      }
      throw Error('Unexpected host command');
    },
    async apply_patch(patch){contexts.push(patch);return {status:'applied'};},
    async mcp__paseo__list_profiles(){return {structuredContent:{profiles:[{id:'sol61-orchestrator',provider:'codex',model:'gpt-6.1-sol',thinkingOptionId:options.wrongProfile?'max':'high',modeId:'auto-review',featureValues:{service_tier:'default',plan_mode:false}}]}};}
  };
  const runtime={tools,load:k=>state.get(k),store:(k,v)=>state.set(k,v),notify:()=>{},ALL_TOOLS:[]};
  const opts={task:'TASK.md',testCommand:'required command',protectedFiles:['TASK.md'],runDir:'/private/tmp/gated-fixture',skillDir:'/installed/skill'};
  return {calls,contexts,state,run:()=>gatedFlow(runtime,opts)};
}
test('host delegates once and accepts only after a real patch/test packet and one tool-free review',async()=>{
  const h=fixture();const result=await h.run();
  assert.equal(result.status,'ACCEPTED');assert.equal(result.reviewInvocations,1);
  assert.deepEqual(h.calls.map(x=>x.kind),['admission','worker','judge']);
  assert.ok(h.contexts[0].includes('ORIGINAL CONTRACT'));assert.ok(h.contexts[0].includes('REAL PATCH'));
  assert.equal(result.providerResponseCount,null);
});
test('one correction and two reviews retain the same reviewer thread and worker',async()=>{
  const h=fixture({decisions:[correction,accept]});const result=await h.run();
  assert.equal(result.status,'ACCEPTED');
  assert.deepEqual(h.calls.filter(x=>x.kind==='worker').map(x=>x.action),['start','correct']);
  assert.ok(h.contexts[1].includes('same-thread'));
  assert.equal(h.calls.filter(x=>x.kind==='judge').length,2);
  await assert.rejects(h.run,/Existing workflow state/);
});
for(const value of [{...accept,action:'exec_command'}, {...accept,command:'cat MEMORY.md'}, {...accept,action:'correct'}, {...correction,defects:[{...correction.defects[0],command:'rerun tests'}]}]){
  test('a reviewer cannot request an unexposed action or command: '+JSON.stringify(value),async()=>{
    const h=fixture({decisions:[value]});await assert.rejects(h.run);
    assert.equal(h.calls.filter(x=>x.kind==='worker').length,1);
  });
}
test('a second correction is rejected without sending a second message or asking for another review',async()=>{
  const h=fixture({decisions:[correction,correction]});await assert.rejects(h.run,/Corrective round/);
  assert.equal(h.calls.filter(x=>x.kind==='worker'&&x.action==='correct').length,1);
  assert.equal(h.calls.filter(x=>x.kind==='judge').length,2);
});
for(const review of [{independentTests:{exitCode:1}},{independentTests:{exitCode:null}},
  {independentTests:{exitCode:0,requestedCommand:'weakened command'}},{trackedPatch:null},
  {protectedChanges:['TASK.md']},{head:'another-commit'},{diffCheck:{exitCode:1}}]){
  test('reviewer acceptance cannot override failed or missing checks: '+JSON.stringify(review),async()=>{
    const h=fixture({review});await assert.rejects(h.run,/Acceptance denied/);
    assert.notEqual(h.state.get('paseoGatedTeam').phase,'ACCEPTED');
  });
}
for(const options of [{admissionFailure:true},{existingDir:true},{wrongProfile:true}]){
  test('failed admission starts no paid worker or reviewer: '+JSON.stringify(options),async()=>{
    const h=fixture(options);await assert.rejects(h.run);
    assert.equal(h.calls.some(x=>x.kind==='worker'||x.kind==='judge'),false);
  });
}
test('changed reviewer identity stops the existing workflow',async()=>{
  const h=fixture({decisions:[correction,accept],changedThread:true});await assert.rejects(h.run,/identity/);
  assert.equal(h.calls.filter(x=>x.kind==='judge').length,2);
});
test('explicit failure terminates instead of inventing another action',async()=>{
  const h=fixture({decisions:[{action:'fail',summary:'Unresolved contract failure',defects:[]}]});
  assert.equal((await h.run()).status,'FAILED');assert.equal(h.calls.filter(x=>x.kind==='worker').length,1);
});
