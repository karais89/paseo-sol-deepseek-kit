/* Executable tool orchestration: no Node dependencies and no model calls of its own. */
module.exports = async function teamFlow(runtime, options) {
  const {tools, load, store, notify, ALL_TOOLS} = runtime;
  const key = 'paseoInlineTeam';
  const dir = options.skillDir;
  if (typeof dir !== 'string' || !dir.startsWith('/'))
    throw Error('Provide the actual absolute installed skillDir');
  const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  function data(result) {
    if (!result || result.isError) throw Error('Paseo action failed; do not retry automatically');
    if (result.structuredContent) return result.structuredContent;
    for (const item of result.content ?? []) if (item.type === 'text') {
      const start = item.text.indexOf('{');
      if (start >= 0) try { return JSON.parse(item.text.slice(start)); } catch {}
    }
    throw Error('Undecodable Paseo response; preserve the attempted action');
  }
  function tool(name) {
    const exact = 'mcp__paseo__' + name;
    const found = typeof tools[exact] === 'function' ? exact
      : ALL_TOOLS.find(t => t.name.endsWith('paseo__' + name))?.name;
    if (!found || typeof tools[found] !== 'function') throw Error('Required Paseo tool unavailable: ' + name);
    return tools[found].bind(tools);
  }
  function reviewPlan(plan) {
    if (!plan || typeof plan.testCommand !== 'string' || !plan.testCommand.trim()
        || !Array.isArray(plan.protectedFiles)
        || !plan.protectedFiles.every(x => typeof x === 'string' && x.length > 0))
      throw Error('Supply the task-required test command and protected paths before launching');
    return {testCommand: plan.testCommand, protectedFiles: plan.protectedFiles};
  }
  async function prepare() {
    if (load(key)) throw Error('Existing inline team state; do not prepare or launch another worker');
    if (typeof options.task !== 'string' || !options.task) throw Error('Missing task path');
    const results = await Promise.allSettled([
      tools.exec_command({cmd: 'python3 ' + quote(dir + '/scripts/team_context.py')
        + ' prepare --task ' + quote(options.task), max_output_tokens: 6000}),
      tool('list_profiles')({}), tool('list_models')({provider: 'opencode'})
    ]);
    if (results.some(r => r.status !== 'fulfilled')) throw Error('Preparation failed; no worker launched');
    const [raw, profiles, catalog] = results.map(r => r.value);
    if (raw.exit_code !== 0) throw Error('Task preparation failed; no worker launched');
    const task = JSON.parse(raw.output);
    const profile = data(profiles).profiles.find(p => p.id === 'deepseek41-worker');
    if (!profile || profile.provider !== 'opencode') throw Error('Required worker profile unavailable');
    const model = options.model ?? profile.model;
    const effort = options.effort ?? profile.thinkingOptionId;
    const entry = data(catalog).models.find(m => m.id === model);
    if (!entry || (entry.thinkingOptions?.length && !entry.thinkingOptions.some(x => x.id === effort)))
      throw Error('Requested worker model or effort unavailable; do not substitute');
    const state = {phase: 'PREPARED', task, profile, model, effort,
      thinkingOptions: entry.thinkingOptions ?? [], correctionAttempted: false};
    store(key, state);
    return state;
  }
  async function awaitReview(state) {
    const plan = reviewPlan(state.reviewPlan);
    let command = 'python3 ' + quote(dir + '/scripts/review_after_worker.py')
      + ' --agent-id ' + quote(state.agentId) + ' --base ' + quote(state.task.revision)
      + ' --test-command ' + quote(plan.testCommand);
    for (const name of plan.protectedFiles) command += ' --protected ' + quote(name);
    // Read the one waiting shell process inside this execution; never poll agent status.
    let result = await tools.exec_command({cmd: command, yield_time_ms: 1000,
      max_output_tokens: 24000, sandbox_permissions: 'require_escalated',
      justification: 'Wait for the already authorized local worker and collect its patch and task-required tests.'});
    const chunks = [result.output ?? ''];
    const started = Date.now();
    let lastProgress = started;
    while (result.session_id) {
      result = await tools.write_stdin({session_id: result.session_id, chars: '',
        yield_time_ms: 30000, max_output_tokens: 24000});
      chunks.push(result.output ?? '');
      if (chunks.reduce((n, x) => n + x.length, 0) > 1000000)
        throw Error('Review output exceeds bounded delivery; retain worker identity and inspect evidence');
      if (result.session_id && Date.now() - lastProgress >= 25000) {
        notify({status: 'WORKER_TOOL_PENDING', agentId: state.agentId,
          elapsedSeconds: Math.floor((Date.now() - started) / 1000)});
        lastProgress = Date.now();
      }
    }
    let packet;
    try { packet = JSON.parse(chunks.join('')); }
    catch { throw Error('Incomplete native wait/review output; do not accept or relaunch'); }
    if (packet.agentId !== state.agentId) throw Error('Wait result belongs to another worker');
    store(key, {...state, phase: packet.status});
    if (result.exit_code !== 0 || packet.status !== 'REVIEW_READY')
      return {status: packet.status, agentId: state.agentId, evidence: packet};
    if (!packet.review) throw Error('Missing actual patch and independent checks');
    return packet;
  }
  if (options.action === 'prepare') {
    const state = await prepare();
    return {status: 'PREPARED', task: state.task.taskText, base: state.task.revision,
      initialStatus: state.task.initialStatus, model: state.model, effort: state.effort};
  }
  if (options.action === 'start') {
    const plan = reviewPlan(options);
    let state = load(key);
    if (!state) state = await prepare();
    if (state.phase !== 'PREPARED') throw Error('Worker launch already attempted; do not repeat it');
    if (options.model !== undefined && options.model !== state.model)
      throw Error('Requested model differs from the prepared catalog entry; do not substitute');
    const effort = options.effort ?? state.effort;
    if (state.thinkingOptions.length && !state.thinkingOptions.some(x => x.id === effort))
      throw Error('Requested effort unavailable; no worker launched');
    state = {...state, effort};
    // A local create without serverId is intentional. Remote workflows use notification mode.
    const create = tool('create_agent');
    store(key, {...state, phase: 'LAUNCH_ATTEMPTED', reviewPlan: plan});
    const created = data(await create({provider: 'opencode/' + state.model,
      title: 'Implement assigned task', notifyOnFinish: false,
      settings: {modeId: state.profile.modeId, thinkingOptionId: state.effort,
        features: state.profile.featureValues}, initialPrompt: state.task.initialPrompt}));
    if (!created.agentId || !created.serverId) throw Error('Worker identity missing; do not launch again');
    state = {...state, phase: 'RUNNING', agentId: created.agentId, serverId: created.serverId,
      reviewPlan: plan};
    store(key, state);
    return await awaitReview(state);
  }
  if (options.action === 'correct') {
    const state = load(key);
    if (!state?.agentId || !state?.serverId || state.phase !== 'REVIEW_READY')
      throw Error('Missing reviewed worker identity');
    if (state.correctionAttempted) throw Error('Bounded correction already attempted; report unresolved evidence');
    const reproductionCommand = options.reproductionCommand ?? null;
    let evidence = options.evidence ?? null;
    if (evidence === null) {
      if (!reproductionCommand) throw Error('Supply reviewed evidence or one targeted reproduction');
      const result = await tools.exec_command({cmd: reproductionCommand, max_output_tokens: 2000});
      if (result.exit_code !== 0) throw Error('Reproduction execution failed; no correction sent');
      evidence = JSON.parse(result.output);
    }
    if (typeof evidence?.defectConfirmed !== 'boolean') throw Error('Invalid defect evidence');
    if (!evidence.defectConfirmed) return {status: 'NOT_REPRODUCED'};
    if (typeof evidence.requirement !== 'string' || !evidence.requirement.trim()
        || !Object.hasOwn(evidence, 'expected') || !Object.hasOwn(evidence, 'observed'))
      throw Error('Missing original requirement or expected/observed behavior');
    const send = tool('send_agent_prompt');
    const attempted = {...state, phase: 'CORRECTION_ATTEMPTED', correctionAttempted: true};
    store(key, attempted);
    data(await send({agentId: state.agentId, serverId: state.serverId, notifyOnFinish: false,
      prompt: 'One bounded correction within the original assignment and permissions. Diagnose and repair '
        + 'the confirmed defect, add regression tests, run the required checks and self-review before reporting. '
        + 'Repair in-scope local failures yourself. Preserve the original contract and all task boundaries. Evidence: '
        + JSON.stringify(evidence) + (reproductionCommand ? '\nReproducer: ' + reproductionCommand : '')}));
    return await awaitReview(attempted);
  }
  throw Error('Unknown inline flow action');
};
