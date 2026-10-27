import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const skill = readFileSync(new URL('../skills/paseo-sol-deepseek/references/notification-flow.md', import.meta.url), 'utf8');
const code = skill.match(/```js\n([\s\S]*?)\n```/)[1];
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

async function simulate(options = {}) {
  const calls = [], saved = {}, printed = [];
  const profile = {id:'deepseek41-worker',provider:'opencode',modeId:'build',thinkingOptionId:'max',featureValues:{auto_accept:false}};
  const before = JSON.stringify(profile);
  const wrap = value => options.textOnly
    ? {content:[{type:'text',text:'compact_metadata=1\n\n'+JSON.stringify(value)}]}
    : {structuredContent:value};
  const tools = {
    async exec_command() {
      calls.push('prepare');
      return {exit_code:options.preparationError ? 1 : 0,
        output:options.preparationError ? 'READ_FAILED' : JSON.stringify({revision:'base',initialStatus:'',taskText:'TASK CONTRACT',initialPrompt:'WORKER CONTRACT'})};
    },
    async mcp__paseo__list_profiles() {calls.push('profiles');return wrap({profiles:[profile]});},
    async mcp__paseo__list_models() {calls.push('models');return wrap({models:options.missingModel ? [] : [{id:'merge-gateway/deepseek/deepseek-v4.1-flash',thinkingOptions:options.options ?? []}]});},
    async mcp__paseo__create_agent(args) {
      calls.push({create:args});
      return wrap({agentId:'worker',serverId:'server',status:'running'});
    },
  };
  let error;
  try {await new AsyncFunction('tools','store','text',code)(tools,(k,v)=>saved[k]=v,v=>printed.push(v));}
  catch (e) {error=e;}
  assert.equal(JSON.stringify(profile),before,'Stored profile was modified');
  return {calls,saved,printed,error};
}

test('one execution prepares, looks up profiles/models, and creates exactly one explicit-high worker',async()=>{
  const r = await simulate({textOnly:true});
  assert.equal(r.error,undefined);
  const creations = r.calls.filter(c=>typeof c==='object');
  assert.equal(creations.length,1);
  assert.deepEqual(r.calls.slice(0,3),['prepare','profiles','models']);
  const args=creations[0].create;
  assert.equal(args.provider,'opencode/merge-gateway/deepseek/deepseek-v4.1-flash');
  assert.equal(args.settings.thinkingOptionId,'high');
  assert.equal(args.settings.features.auto_accept,false);
  assert.equal(args.initialPrompt,'WORKER CONTRACT');
  assert.equal(args.notifyOnFinish,true);
  assert.equal(r.saved.paseoTeam.base,'base');
  assert.equal(r.printed.length,1);
  assert.equal(JSON.stringify(r.printed).includes('WORKER CONTRACT'),false);
});

for(const options of [{preparationError:true},{missingModel:true},{options:[{id:'low'}]}]) {
  test(`failed preparation never launches or retries: ${JSON.stringify(options)}`,async()=>{
    const r=await simulate(options);
    assert.ok(r.error);
    assert.equal(r.calls.some(c=>typeof c==='object'),false);
    assert.equal(r.printed.length,0);
  });
}
