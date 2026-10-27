/* Host-owned workflow. The Sol reviewer returns data and has no execution tools. */
module.exports = async function gatedFlow(runtime, options) {
  const {tools,load,store,notify,ALL_TOOLS}=runtime;
  const stateKey='paseoGatedTeam';
  const dir=options.skillDir;
  if(typeof dir!=='string'||!dir.startsWith('/'))throw Error('Provide the actual absolute installed skillDir');
  const quote=x=>"'"+String(x).replaceAll("'","'\\''")+"'";
  const save=value=>store(stateKey,value);
  const required=x=>typeof x==='string'&&x.trim();
  function data(r){
    if(!r||r.isError)throw Error('Native action failed');
    if(r.structuredContent)return r.structuredContent;
    for(const c of r.content??[])if(c.type==='text'){const i=c.text.indexOf('{');if(i>=0)try{return JSON.parse(c.text.slice(i));}catch{}}
    throw Error('Invalid native response');
  }
  async function process(command){
    let r=await tools.exec_command({cmd:command,yield_time_ms:1000,max_output_tokens:16000,
      sandbox_permissions:'require_escalated',justification:'Run the authorized tool-free reviewer or its offline admission check.'});
    const chunks=[r.output??''];let last=Date.now();
    while(r.session_id){r=await tools.write_stdin({session_id:r.session_id,chars:'',yield_time_ms:30000,max_output_tokens:16000});chunks.push(r.output??'');
      if(r.session_id&&Date.now()-last>=25000){notify({status:'GATED_REVIEW_PENDING'});last=Date.now();}}
    if(r.exit_code!==0)throw Error('Gated reviewer failed; preserve the existing worker and do not retry');
    return JSON.parse(chunks.join(''));
  }
  function checks(packet){
    const r=packet?.review;
    if(packet?.status!=='REVIEW_READY'||!r||r.base!==r.head||r.protectedChanges?.length!==0
      ||r.diffCheck?.exitCode!==0||r.independentTests?.exitCode!==0
      ||r.independentTests?.requestedCommand!==options.testCommand
      ||typeof r.trackedPatch!=='string'||!Array.isArray(r.newFiles))return false;
    return true;
  }
  function decision(value,corrected){
    if(!value||Object.keys(value).sort().join()!=='action,defects,summary'||!['accept','correct','fail'].includes(value.action)
      ||!required(value.summary)||!Array.isArray(value.defects))throw Error('Unsupported reviewer decision');
    for(const d of value.defects)if(!d||Object.keys(d).sort().join()!=='expected,observed,requirement'
      ||!Object.values(d).every(required))throw Error('Incomplete defect evidence');
    if(value.action==='accept'&&value.defects.length)throw Error('Conflicting acceptance');
    if(value.action==='correct'&&(corrected||!value.defects.length))throw Error('Corrective round unavailable');
    return value;
  }
  if(load(stateKey)||load('paseoInlineTeam'))throw Error('Existing workflow state; do not start a second workflow');
  if(!required(options.task)||!required(options.testCommand)||!Array.isArray(options.protectedFiles)
    ||!options.protectedFiles.every(required)||!required(options.runDir)||!/^\/private\/tmp\/[A-Za-z0-9_-]+$/.test(options.runDir))
    throw Error('Provide a frozen task, required checks, protected paths and a fresh private tmp run directory');
  // Gate the native reviewer before creating a paid worker.
  const admission=await process('python3 '+quote(dir+'/scripts/sol_judge.py')+' --preflight --audit '+quote(dir+'/scripts/sol-tool-audit.json'));
  if(admission.status!=='PASS'||admission.advertisedTools?.length!==0)throw Error('Reviewer tool admission failed');
  const reserved=await tools.exec_command({cmd:"python3 -c 'import pathlib,sys; pathlib.Path(sys.argv[1]).mkdir(mode=0o700)' "+quote(options.runDir),max_output_tokens:1000});
  if(reserved.exit_code!==0)throw Error('Run directory is not fresh; do not overwrite prior evidence');
  const profileTool=typeof tools.mcp__paseo__list_profiles==='function'?'mcp__paseo__list_profiles':ALL_TOOLS.find(x=>x.name.endsWith('paseo__list_profiles'))?.name;
  if(!profileTool)throw Error('Native profiles unavailable');
  const sol=data(await tools[profileTool]({})).profiles.find(x=>x.id==='sol61-orchestrator');
  if(!sol||sol.provider!=='codex'||sol.model!=='gpt-6.1-sol'||sol.thinkingOptionId!=='high'
    ||sol.modeId!=='auto-review'||Object.entries(sol.featureValues??{}).some(([k,v])=>!((k==='service_tier'&&v==='default')||(k==='plan_mode'&&v===false))))
    throw Error('Sol profile differs from the inspected route; no worker launched');
  const source=await tools.exec_command({cmd:'cat '+quote(dir+'/scripts/team_flow.cjs'),max_output_tokens:12000});
  if(source.exit_code!==0)throw Error('Native worker flow unavailable');
  const module={exports:{}};new Function('module',source.output)(module);const workerFlow=module.exports;
  save({phase:'LAUNCH_ATTEMPTED',reviewInvocations:0,corrected:false});
  let packet=await workerFlow(runtime,{action:'start',task:options.task,testCommand:options.testCommand,
    protectedFiles:options.protectedFiles,model:options.model,effort:options.effort,skillDir:dir});
  let threadId=null,corrected=false;const reviewUsage=[];
  for(let round=0;round<2;round++){
    const native=load('paseoInlineTeam');
    if(packet?.status!=='REVIEW_READY'){
      save({...load(stateKey),phase:'BLOCKED'});return {status:'BLOCKED',workerId:native?.agentId,evidence:packet};
    }
    const context={phase:corrected?'review_corrected':'review_initial',cwd:native.task.cwd,
      threadId,contract:native.task.taskText,initialStatus:native.task.initialStatus,packet};
    const path=options.runDir+'/review-'+round+'.json';
    const patch='*** Begin Patch\n*** Add File: '+path+'\n'+JSON.stringify(context,null,2).split('\n').map(x=>'+'+x).join('\n')+'\n*** End Patch';
    const written=await tools.apply_patch(patch);
    if(written?.isError)throw Error('Could not retain host-owned review evidence');
    save({...load(stateKey),phase:context.phase,reviewInvocations:round+1,corrected});
    const result=await process('python3 '+quote(dir+'/scripts/sol_judge.py')+' --audit '+quote(dir+'/scripts/sol-tool-audit.json')+' --input '+quote(path));
    if(result.status!=='REVIEW_DECISION'||!result.threadId||(threadId&&threadId!==result.threadId))throw Error('Reviewer identity or result invalid');
    threadId=result.threadId;reviewUsage.push({usage:result.usage,accounting:result.accounting});
    const value=decision(result.decision,corrected);
    if(value.action==='accept'){
      if(!checks(packet))throw Error('Acceptance denied by real checks or task boundaries');
      save({...load(stateKey),phase:'ACCEPTED'});
      return {status:'ACCEPTED',workerId:native.agentId,solThreadId:threadId,reviewUsage,
        reviewInvocations:round+1,summary:value.summary,checks:packet.review.independentTests,
        providerResponseCount:null,providerResponseCountStatus:'COLLECT_NATIVE_REQUEST_RECORDS'};
    }
    if(value.action==='fail'){
      save({...load(stateKey),phase:'FAILED'});return {status:'FAILED',workerId:native.agentId,solThreadId:threadId,reviewUsage,decision:value};
    }
    corrected=true;save({...load(stateKey),phase:'CORRECTION_ATTEMPTED',corrected:true});
    packet=await workerFlow(runtime,{action:'correct',evidence:{defectConfirmed:true,
      requirement:value.defects.map(x=>x.requirement).join('\n'),
      expected:value.defects.map(x=>x.expected).join('\n'),observed:value.defects.map(x=>x.observed).join('\n')},skillDir:dir});
  }
  throw Error('Gated review budget exhausted');
};
