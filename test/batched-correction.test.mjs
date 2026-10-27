import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const skill = readFileSync(new URL('../skills/paseo-sol-deepseek/references/notification-flow.md', import.meta.url), 'utf8');
const code = [...skill.matchAll(/```js\n([\s\S]*?)\n```/g)][1][1];
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const execute = new AsyncFunction('tools','load','store','text','confirmedEvidence','reproductionCommand',code);
const defect = {defectConfirmed:true,requirement:'Every data record has exactly five fields',expected:'ValueError',observed:'One-field record accepted'};

function harness(options={}) {
  let state={agentId:'same-worker',serverId:'same-server',base:'original-base',task:'ORIGINAL CONTRACT',correctionAttempted:false,...options.state};
  const calls=[], printed=[];
  const tools={
    async exec_command(args) {
      calls.push({action:'probe',args});
      return options.probe ?? {exit_code:0,output:JSON.stringify(defect)};
    },
    async mcp__paseo__send_agent_prompt(args) {
      calls.push({action:'send',args});
      if(options.transportError) throw Error('Ambiguous transport failure');
      return options.receipt ?? {structuredContent:{status:'queued'}};
    }
  };
  return {calls,printed,state:()=>state,async run(evidence=null,command='targeted-check') {
    await execute(tools,()=>state,(key,value)=>{assert.equal(key,'paseoTeam');state=value;},x=>printed.push(x),evidence,command);
  }};
}

test('known failure is sent once to the existing worker without repeated reproduction or discovery',async()=>{
  const h=harness();await h.run(defect,null);
  assert.deepEqual(h.calls.map(c=>c.action),['send']);
  const request=h.calls[0].args;
  assert.equal(request.agentId,'same-worker');
  assert.equal(request.serverId,'same-server');
  assert.equal(request.notifyOnFinish,true);
  assert.equal(Object.hasOwn(request,'settings'),false);
  assert.ok(request.prompt.includes(JSON.stringify(defect)));
  assert.equal(h.state().task,'ORIGINAL CONTRACT');
  assert.equal(h.state().correctionAttempted,true);
  assert.deepEqual(h.printed,[{status:'CORRECTION_REQUEST_SENT',agentId:'same-worker'}]);
});

test('one execution reproduces and sends in dependency order',async()=>{
  const h=harness();await h.run();
  assert.deepEqual(h.calls.map(c=>c.action),['probe','send']);
  assert.ok(h.calls[1].args.prompt.includes('targeted-check'));
});

test('non-reproduced behavior sends no corrective request',async()=>{
  const h=harness({probe:{exit_code:0,output:JSON.stringify({defectConfirmed:false})}});await h.run();
  assert.deepEqual(h.calls.map(c=>c.action),['probe']);
  assert.equal(h.state().correctionAttempted,false);
  assert.deepEqual(h.printed,[{status:'NOT_REPRODUCED'}]);
});

for(const probe of [{exit_code:1,output:'ImportError: missing dependency'},
                    {exit_code:0,output:'not json'},
                    {exit_code:0,output:JSON.stringify({defectConfirmed:true})}]) {
  test(`invalid evidence does not trigger a correction: ${JSON.stringify(probe)}`,async()=>{
    const h=harness({probe});
    await assert.rejects(()=>h.run());
    assert.equal(h.calls.some(c=>c.action==='send'),false);
    assert.equal(h.state().correctionAttempted,false);
  });
}

test('uncertain delivery retains the attempted flag and prevents automatic resend',async()=>{
  const h=harness({transportError:true});
  await assert.rejects(()=>h.run(defect,null),/transport/);
  assert.equal(h.state().correctionAttempted,true);
  await assert.rejects(()=>h.run(defect,null),/already attempted/);
  assert.deepEqual(h.calls.map(c=>c.action),['send']);
});

test('missing retained identity causes no probe or message',async()=>{
  const h=harness({state:{agentId:null}});
  await assert.rejects(()=>h.run(),/identity/);
  assert.deepEqual(h.calls,[]);
});
