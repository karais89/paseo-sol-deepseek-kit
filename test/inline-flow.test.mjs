import {test} from 'node:test';
import assert from 'node:assert/strict';
import teamFlow from '../skills/paseo-sol-deepseek/scripts/team_flow.cjs';

const plan={testCommand:'PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v',protectedFiles:['TASK.md','tests/test_public.py']};
const defect={defectConfirmed:true,requirement:'Every data record has five fields',expected:'ValueError',observed:'accepted'};
function fixture(options={}) {
  let state;
  const calls=[],progress=[];
  const profile={id:'deepseek41-worker',provider:'opencode',model:'merge-gateway/deepseek/deepseek-v4.1-flash',thinkingOptionId:'max',modeId:'build',featureValues:{auto_accept:false}};
  const original=JSON.stringify(profile);
  const wrapped=x=>({structuredContent:x});
  const packet={status:'REVIEW_READY',agentId:'worker',review:{trackedPatch:'REAL PATCH',newFiles:[{path:'tests/test_extra.py',text:'REAL TESTS'}],independentTests:{exitCode:options.testFailure?1:0}}};
  const tools={
    async exec_command(args) {
      calls.push({kind:'shell',args});
      if(args.cmd.includes('team_context.py'))return {exit_code:0,output:JSON.stringify({revision:'base',initialStatus:' M initial.txt',taskText:'ORIGINAL TASK WITH TEST COMMAND',initialPrompt:'CONTRACT AND REPOSITORY INSTRUCTIONS'})};
      if(args.cmd.includes('review_after_worker.py')){
        if(options.waitFailure)return {exit_code:2,output:JSON.stringify({status:'WAIT_PERMISSION',agentId:'worker',review:null})};
        if(options.chunked)return {session_id:31,output:JSON.stringify(packet).slice(0,20)};
        return {exit_code:0,output:JSON.stringify(packet)};
      }
      return options.probe??{exit_code:0,output:JSON.stringify(defect)};
    },
    async write_stdin(args){calls.push({kind:'terminal',args});return {exit_code:0,output:JSON.stringify(packet).slice(20)};},
    async mcp__paseo__list_profiles(){calls.push({kind:'profiles'});return wrapped({profiles:[profile]});},
    async mcp__paseo__list_models(){calls.push({kind:'models'});return wrapped({models:[{id:profile.model,thinkingOptions:[]} ]});},
    async mcp__paseo__create_agent(args){calls.push({kind:'create',args});if(options.createFailure)throw Error('uncertain launch');return wrapped({agentId:'worker',serverId:'server'});},
    async mcp__paseo__send_agent_prompt(args){calls.push({kind:'send',args});if(options.sendFailure)throw Error('uncertain delivery');return wrapped({status:'queued'});}
  };
  const runtime={tools,load:()=>state,store:(key,value)=>{assert.equal(key,'paseoInlineTeam');state=value;},notify:x=>progress.push(x),ALL_TOOLS:[]};
  return {calls,progress,get state(){return state;},async run(opts){const result=await teamFlow(runtime,{skillDir:'/installed/skill',...opts});assert.equal(JSON.stringify(profile),original);return result;}};
}
test('file-only task is read once, then start returns actual review without a separate acknowledgement',async()=>{
  const h=fixture();const prepared=await h.run({action:'prepare',task:'TASK.md',effort:'high'});
  assert.equal(prepared.task,'ORIGINAL TASK WITH TEST COMMAND');
  const result=await h.run({action:'start',...plan});
  assert.equal(result.review.trackedPatch,'REAL PATCH');
  assert.equal(result.review.newFiles[0].text,'REAL TESTS');
  assert.equal(h.calls.filter(x=>x.kind==='profiles').length,1);
  const create=h.calls.find(x=>x.kind==='create').args;
  assert.equal(create.notifyOnFinish,false);assert.equal(create.settings.thinkingOptionId,'high');
  assert.equal(create.settings.features.auto_accept,false);
  assert.equal(create.initialPrompt,'CONTRACT AND REPOSITORY INSTRUCTIONS');
  assert.equal(h.calls.some(x=>x.kind==='send'),false);
});
test('known review plan prepares, creates and reviews in one execution',async()=>{
  const h=fixture();const r=await h.run({action:'start',task:'TASK.md',...plan});
  assert.equal(r.status,'REVIEW_READY');
  assert.equal(h.calls.find(x=>x.kind==='create').args.settings.thinkingOptionId,'max');
});
test('explicit effort on start is honored after an earlier contract-only preparation',async()=>{
  const h=fixture();await h.run({action:'prepare',task:'TASK.md'});
  await h.run({action:'start',effort:'high',...plan});
  assert.equal(h.calls.find(x=>x.kind==='create').args.settings.thinkingOptionId,'high');
});
test('a changed model cannot silently use the earlier model or create a worker',async()=>{
  const h=fixture();await h.run({action:'prepare',task:'TASK.md'});
  await assert.rejects(()=>h.run({action:'start',model:'another/model',...plan}),/differs/);
  assert.equal(h.calls.some(x=>x.kind==='create'),false);
});
test('reads only the same pending terminal and joins its complete packet',async()=>{
  const h=fixture({chunked:true});const r=await h.run({action:'start',task:'TASK.md',...plan});
  assert.equal(r.review.trackedPatch,'REAL PATCH');
  const reads=h.calls.filter(x=>x.kind==='terminal');assert.equal(reads.length,1);assert.equal(reads[0].args.session_id,31);
});
test('known defect is sent once to the same worker and corrected patch returns in that execution',async()=>{
  const h=fixture();await h.run({action:'start',task:'TASK.md',...plan});
  const before=h.calls.length;const result=await h.run({action:'correct',evidence:defect});
  assert.equal(result.status,'REVIEW_READY');
  assert.deepEqual(h.calls.slice(before).map(x=>x.kind),['send','shell']);
  const send=h.calls.find(x=>x.kind==='send').args;
  assert.equal(send.agentId,'worker');assert.equal(send.serverId,'server');assert.equal(send.notifyOnFinish,false);
  assert.ok(send.prompt.includes(JSON.stringify(defect)));
  await assert.rejects(()=>h.run({action:'correct',evidence:defect}),/already attempted/);
});
test('targeted reproduction, correction delivery and review stay in dependency order',async()=>{
  const h=fixture();await h.run({action:'start',task:'TASK.md',...plan});const n=h.calls.length;
  await h.run({action:'correct',reproductionCommand:'targeted reproduction'});
  assert.deepEqual(h.calls.slice(n).map(x=>x.kind),['shell','send','shell']);
});
for(const probe of [{exit_code:1,output:'ImportError'}, {exit_code:0,output:'not JSON'}, {exit_code:0,output:JSON.stringify({defectConfirmed:true})}]){
  test('execution or evidence failure never sends a correction: '+JSON.stringify(probe),async()=>{
    const h=fixture({probe});await h.run({action:'start',task:'TASK.md',...plan});
    await assert.rejects(()=>h.run({action:'correct',reproductionCommand:'probe'}));
    assert.equal(h.calls.some(x=>x.kind==='send'),false);
  });
}
test('non-reproduced probe needs no message or second review',async()=>{
  const h=fixture({probe:{exit_code:0,output:'{"defectConfirmed":false}'}});await h.run({action:'start',task:'TASK.md',...plan});const n=h.calls.length;
  assert.equal((await h.run({action:'correct',reproductionCommand:'probe'})).status,'NOT_REPRODUCED');
  assert.deepEqual(h.calls.slice(n).map(x=>x.kind),['shell']);
});
test('permission is returned as a blocker, while a failing test remains review evidence',async()=>{
  const blocked=fixture({waitFailure:true});assert.equal((await blocked.run({action:'start',task:'TASK.md',...plan})).status,'WAIT_PERMISSION');
  const failed=fixture({testFailure:true});assert.equal((await failed.run({action:'start',task:'TASK.md',...plan})).review.independentTests.exitCode,1);
});
test('uncertain launch or send cannot cause an automatic duplicate',async()=>{
  const launch=fixture({createFailure:true});await assert.rejects(()=>launch.run({action:'start',task:'TASK.md',...plan}));
  await assert.rejects(()=>launch.run({action:'start',task:'TASK.md',...plan}),/already attempted/);
  assert.equal(launch.calls.filter(x=>x.kind==='create').length,1);
  const send=fixture({sendFailure:true});await send.run({action:'start',task:'TASK.md',...plan});
  await assert.rejects(()=>send.run({action:'correct',evidence:defect}));
  await assert.rejects(()=>send.run({action:'correct',evidence:defect}));
  assert.equal(send.calls.filter(x=>x.kind==='send').length,1);
});
test('missing required checks blocks before any worker launch',async()=>{
  const h=fixture();await assert.rejects(()=>h.run({action:'start',task:'TASK.md'}));assert.deepEqual(h.calls,[]);
});
test('task-local commands and protected paths retain literal shell characters',async()=>{
  const h=fixture();await h.run({action:'start',task:'TASK.md',testCommand:"python3 -c 'print(\"$(touch no)\")'",protectedFiles:["a'b.txt"]});
  const command=h.calls.find(x=>x.kind==='shell'&&x.args.cmd.includes('review_after_worker')).args.cmd;
  assert.ok(command.includes("'a'\\''b.txt'"));
  assert.ok(command.includes('$(touch no)'));
});
