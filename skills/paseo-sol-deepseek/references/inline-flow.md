# Paseo Sol + DeepSeek

Sol owns scope and final acceptance. One persistent DeepSeek worker investigates, implements, writes behavioral tests, repairs its own failures and self-reviews. Keep Sol planning and acceptance in the same conversation. Use the current task and repository instructions; preserve existing edits, protected files, permissions, profiles and authentication. Selecting a profile does not invoke this skill.

## Local worker: return its completed patch in the same tool execution

Use the installed `team_flow.cjs` through the loader below. It prepares the contract, uses the existing `deepseek41-worker` profile, and preserves the user's explicit model/effort. Unspecified choices come from that profile. Sol uses `sol61-orchestrator` settings. No substitutions or extra agents.

The inline flow disables completion notifications and holds **one tool execution** through native completion waiting and independent review collection. Do not generate a delegation/waiting acknowledgement, end the turn after creation, or separately ask for the patch/tests. Deterministic progress updates come from the pending tool, without asking Sol to write them.

Choose an action:

- `prepare`: when the task is only named as a file, return its contract once so Sol can identify the required test command and protected paths. Do not inspect implementation first or print catalogs. Continue directly with `start`.
- `start`: supply `testCommand` and `protectedFiles` from that contract. If already known, also supply `task` and skip `prepare`. It creates one local worker, waits up to 20 minutes and returns the complete patch, untracked files, test results and scope evidence.
- `correct`: after reviewing concrete defects, supply `evidence: {defectConfirmed:true, requirement, expected, observed}`. If evidence still needs one targeted probe, supply `reproductionCommand` instead; it must output that JSON object. The same execution reproduces if needed, sends one correction to the retained worker, waits and returns the corrected review. Diagnosis, code changes and regression tests stay with the worker.

Use this loader inside `functions.exec`, preserving the first-line pragma. Change only `options` for each action. The example's `high` applies only when explicitly requested; otherwise omit `effort`.

```js
// @exec: {"yield_time_ms": 1800000, "max_output_tokens": 26000}
const options = {action:"prepare", task:"TASK.md", effort:"high", skillDir:"<actual installed absolute directory of this skill>"};
const source = await tools.exec_command({
  cmd:"cat '" + (options.skillDir + "/scripts/team_flow.cjs").replaceAll("'", "'\\''") + "'",
  max_output_tokens:12000
});
if (source.exit_code !== 0) throw Error("Installed team flow unavailable");
const module = {exports:{}};
new Function("module", source.output)(module);
text(await module.exports({tools,load,store,notify,ALL_TOOLS}, options));
```

For example, `start` options are `{action:"start", testCommand:"<task-required command>", protectedFiles:["<protected path>"]}`. Use the actual task's checks and paths. Source and prepared worker prompts are consumed inside the execution, without copying them into Sol's context.

The native wait handles queued follow-ups, completion, errors and permissions. Terminal reads belong to the same pending shell process; do not replace this with agent status polling. If the runtime yields an exec cell, resume that cell with `functions.wait`, never relaunch the worker; count any such responses as usage. Long-duration pending-tool behavior remains a live validation requirement.

On timeout, permission, error, invalid evidence or uncertain delivery, retain the worker identity and report the actual blocker. Do not count idle/exit zero alone as acceptance, auto-resend, start another worker or change settings. Default to one bounded corrective round; report remaining defects after its review.

Sol must inspect the real patch/tests against the original contract and initial edits, then provide the final result in Korean. Keep required checks. Add a targeted check only for a concrete evidence gap. Never silently truncate evidence or accept a worker summary as proof.

## Other execution contexts

Before creating a remote worker, or when pending tool execution is unavailable, use [notification mode](notification-flow.md). Do not mix its completion callbacks with inline waiting. For substantial independent research see [research assignments](research.md); additional agents still need task authorization.

## Measurement

Count all actual Sol, worker and auxiliary provider responses, including any tool-resume responses. Cached input and reasoning are subsets, not extra tokens to double-count. Separate elapsed time, tests and billing; missing usage is incomplete accounting. Do not export secrets or prompt/response bodies. Offline tests and a reduced execution plan do not prove live token savings or a fixed response count.
