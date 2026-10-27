# Paseo Sol + DeepSeek

Sol owns scope, delegation and final acceptance. One persistent DeepSeek worker investigates, implements, writes behavioral tests and repairs its own failures. Keep planning and review in the same Sol conversation. Selecting a profile does not invoke this skill; invoke `$paseo-sol-deepseek` with the task.

## Delegate a clear file assignment in one tool execution

Use this skill's already injected text; do not reread SKILL.md. When the user names an existing self-contained task file with scope and acceptance checks, forward that contract directly. Do not inspect the implementation first or split deterministic preparation into separate model decisions. The helper below reads the assignment, applicable task-local instructions, starting revision and initial edits; it makes no model calls or file changes. The worker investigates the source.

Use this pattern inside **one `functions.exec`**, substituting only the user-specified task/model/effort. The helper path is relative to this installed skill directory. Do not print tool catalogs, raw profiles, the prepared worker prompt or redundant source dumps. The three lookups run concurrently and creation follows them within this same execution.

```js
function data(r) {
  if (r.isError) throw Error("Paseo lookup failed");
  if (r.structuredContent) return r.structuredContent;
  for (const c of r.content ?? []) if (c.type === "text") {
    const i = c.text.indexOf("{");
    if (i >= 0) try { return JSON.parse(c.text.slice(i)); } catch {}
  }
  throw Error("Undecodable result; do not dump the catalog");
}
const requestedModel = "merge-gateway/deepseek/deepseek-v4.1-flash";
const requestedEffort = "high"; // use the user's explicit choice; otherwise the profile value
const results = await Promise.allSettled([
  tools.exec_command({cmd:"python3 <actual-installed-skill-directory>/scripts/team_context.py prepare --task TASK.md",max_output_tokens:6000}),
  tools.mcp__paseo__list_profiles({}),
  tools.mcp__paseo__list_models({provider:"opencode"})
]);
if (results.some(r => r.status === "rejected")) throw Error("Preparation failed; worker not launched");
const [raw, profiles, catalog] = results.map(r => r.value);
if (raw.exit_code !== 0) throw Error(raw.output);
const task = JSON.parse(raw.output);
const profile = data(profiles).profiles.find(p => p.id === "deepseek41-worker");
if (!profile || profile.provider !== "opencode") throw Error("Required worker profile unavailable");
const model = data(catalog).models.find(m => m.id === requestedModel);
if (!model) throw Error("Requested model unavailable");
const effort = requestedEffort ?? profile.thinkingOptionId;
if (model.thinkingOptions?.length && !model.thinkingOptions.some(o => o.id === effort))
  throw Error("Requested effort unavailable; do not substitute");
const created = data(await tools.mcp__paseo__create_agent({
  provider: "opencode/" + requestedModel, title: "Implement assigned task",
  settings: {modeId:profile.modeId,thinkingOptionId:effort,features:profile.featureValues},
  notifyOnFinish:true,initialPrompt:task.initialPrompt
}));
store("paseoTeam", {base:task.revision,initialStatus:task.initialStatus,correctionAttempted:false,
  task:task.taskText,agentId:created.agentId,serverId:created.serverId});
text({agentId:created.agentId,serverId:created.serverId,status:created.status,
  base:task.revision,initialStatus:task.initialStatus,task:task.taskText,
  model:requestedModel,effort});
```

An empty effort catalog means options are unenumerated, not verified unsupported or supported. Creation validates the requested setting; stop on a launch error without model substitutions, stub testing or repeated status/report turns. Never change the stored profile, permissions, authentication or provider configuration. The example's `high` is not a default override: use an explicit user choice, or the profile value when unspecified.

If the task is ambiguous or lacks a contract, first gather the missing relevant task/source context in one batch, then delegate a bounded assignment. Do not search unrelated personal memory/history. Use one worker by default, no extra review agent. For substantial research or genuinely independent parallel scopes, consult [research assignments](research.md). Preserve initial edits and task boundaries. Additional agents or model changes require task authorization.

## Yield to notifications

After creation, end the turn with a short delegation acknowledgement. Do not perform a status lookup or invent additional work. Paseo completion/error/permission notifications resume the same Sol conversation. Waiting itself needs no model calls. Acknowledgement generation may still require one response in the existing runtime; do not promise a two-request workflow.

For a nested coordinator with an explicitly supplied outer recipient, use [nested completion](nested-completion.md); an independent user conversation needs no outer report.

## Give diagnosis and repair back to the worker

If review already contains a failing test or concrete contradictory behavior, send that evidence directly to the same worker; do not reproduce the same failure again. The worker owns diagnosis, code changes, regression tests and the repair loop. Preserve the original contract: do not add a requirement merely to preserve current implementation behavior.

If one targeted reproduction is still needed, run it and conditionally send the correction **inside the same `functions.exec`** using this pattern. Set `confirmedEvidence` to an already reviewed evidence object or `null`. Only when it is null, set `reproductionCommand` to a task-local command that prints one JSON object with boolean `defectConfirmed` and, for a defect, `requirement`, `expected` and `observed`. A command error or undecodable output is not a confirmed product defect.

```js
const worker = load("paseoTeam");
if (!worker?.agentId || !worker?.serverId) throw Error("Missing retained worker identity");
if (worker.correctionAttempted) throw Error("Bounded correction already attempted; report unresolved evidence");
let evidence = confirmedEvidence;
if (evidence == null) {
  if (!reproductionCommand) throw Error("Provide reviewed evidence or a targeted reproduction");
  const probe = await tools.exec_command({cmd:reproductionCommand,max_output_tokens:2000});
  if (probe.exit_code !== 0) throw Error("Probe execution failed; do not send an inferred defect");
  evidence = JSON.parse(probe.output);
}
if (typeof evidence?.defectConfirmed !== "boolean") throw Error("Invalid reproduction evidence");
if (!evidence.defectConfirmed) {
  text({status:"NOT_REPRODUCED"});
} else {
  if (!evidence.requirement || !("expected" in evidence) || !("observed" in evidence))
    throw Error("Missing original requirement or observed result");
  store("paseoTeam", {...worker,correctionAttempted:true});
  const receipt = await tools.mcp__paseo__send_agent_prompt({
    agentId:worker.agentId,serverId:worker.serverId,notifyOnFinish:true,
    prompt:"One bounded correction within the original assignment and permissions. Diagnose and repair the confirmed defect, add regression tests, run the required checks, inspect your changes and fix in-scope failures before reporting. Do not ask Sol to approve each local repair step or change unrelated behavior. Report actual commands/results and unresolved issues. Evidence: " + JSON.stringify(evidence)
      + (reproductionCommand ? "\nReproducer: " + reproductionCommand : "")
  });
  if (!receipt || receipt.isError) throw Error("Correction request failed or uncertain; do not automatically resend");
  text({status:"CORRECTION_REQUEST_SENT",agentId:worker.agentId});
}
```

The follow-up method and signature are above; do not search for `send_message` or rediscover already known profiles/models. Retain the attempt flag on failure or uncertain delivery, never automatically resend. Default to one bounded corrective round. After sending, yield as described above; the runtime may still generate one acknowledgement response. Resume on completion, collect the corrected patch and required checks together, and make the final acceptance decision. If still unresolved, report the remaining defect. Do not introduce additional model runs to meet a token target.

## Collect the full patch and tests together, then decide

On completion, run the helper's `review` action once using the recorded starting revision, the task's required test command, and its protected files. It collects tracked changes (including staged changes), every untracked file once in full, independent test results, scope status and diff checking. For example:

```text
python3 <actual-installed-skill-directory>/scripts/team_context.py review --base <recorded-revision> --test-command 'python3 -m unittest discover -s tests -v' --protected TASK.md --protected tests/test_public.py --protected sample.csv
```

Use the actual task's tests and protected paths; the example is not a universal test requirement. The helper sets `PYTHONDONTWRITEBYTECODE=1`. Do not separately fetch the same patch or run the same tests again. Add a targeted check only for a concrete evidence gap; a specific defect justifies a corrective round. Oversized or failed evidence needs focused inspection, never silent truncation or acceptance.

Sol must review the real patch and new tests against the contract, initial edits and boundaries. A worker report or exit zero alone does not establish acceptance. Do not remove required checks for a token target. Return the outcome, observed checks and unresolved issues in Korean.

## Measurement

Count actual provider responses and their usage, including preparation, acknowledgement, corrections and final reporting. Cached input is a subset of input; reasoning may be a subset of generation. Missing usage is incomplete accounting. Separate Sol, worker and auxiliary requests, elapsed time, tests and billing. Do not export secrets or prompt/response bodies to measurement logs or claim a general reduction from one run.
