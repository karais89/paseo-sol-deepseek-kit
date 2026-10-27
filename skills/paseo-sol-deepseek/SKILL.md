---
name: paseo-sol-deepseek
description: Coordinate development in Paseo with Sol 6.1 and OpenCode Merge Gateway DeepSeek V4.1 Flash workers when the user requests this team or delegates implementation to DeepSeek. Use for the Sol + DeepSeek workflow, not for ordinary solo coding or managing Paseo configuration.
---

# Paseo Sol + DeepSeek

Use the gated host executor for a bounded task whose contract, required test command and protected paths are known. The host runs one persistent DeepSeek worker. A dedicated Sol 6.1 high review thread sees the original contract and real patch/test evidence, with no execution tools. It can return only accept, one evidence-based correction, or failure. The host enforces the transitions and required checks.

Read [gated execution](references/gated-runner.md) before the first use. This restriction applies to the dedicated reviewer, not to the ordinary Paseo conversation launching it. Do not claim that installing this skill restricts that conversation's general tools. Count launcher and reporting responses separately when measuring the whole user workflow.

Before launch, obtain the task's exact test command and protected paths. If only a task filename is supplied, read its self-contained contract once; do not search unrelated memory or inspect implementation before delegating. Preserve existing edits and task boundaries. Selecting a profile does not invoke the skill.

Use this loader inside one `functions.exec`. Fill `options` from the actual contract and set `skillDir` to this skill's actual installed absolute directory; use a fresh run directory under `/private/tmp`. The example checks and `high` are not universal defaults: preserve the user's explicit settings. The currently inspected reviewer route supports `sol61-orchestrator` with Sol 6.1 high, auto-review profile settings and default service tier; it stops on a mismatch rather than substituting.

```js
// @exec: {"yield_time_ms": 1800000, "max_output_tokens": 6000}
const options = {
  skillDir:"<actual installed absolute directory of this skill>",
  task:"TASK.md", testCommand:"<task-required command>",
  protectedFiles:["<actual protected paths>"],
  runDir:"/private/tmp/paseo-gated-UNIQUE_RUN_ID", effort:"high"
};
const source = await tools.exec_command({
  cmd:"cat '" + (options.skillDir + "/scripts/gated_flow.cjs").replaceAll("'", "'\\''") + "'",
  max_output_tokens:12000
});
if (source.exit_code !== 0) throw Error("Gated host executor unavailable");
const module = {exports:{}};
new Function("module", source.output)(module);
text(await module.exports({tools,load,store,notify,ALL_TOOLS}, options));
```

The pending host execution supplies progress, waits for the native worker, collects the patch and required tests, asks the restricted Sol reviewer, and executes at most one correction on the same worker. Do not launch another Sol coordinator/reviewer manually, generate waiting acknowledgements, poll agent status, or repeat the returned patch/tests. Do not accept an advisory summary over actual failed or missing checks. If an exec cell yields, resume the same cell rather than restarting work.

Report the host result, actual check evidence and unresolved issues in Korean. On error, permission, timeout, stale tool audit, invalid model action or ambiguous delivery, retain the existing evidence and worker identity; do not automatically retry, change providers or loosen restrictions. An accepted structured review is still subject to any separately required independent evaluation.

## Other contexts and measurement

The older [inline flow](references/inline-flow.md) and [notification flow](references/notification-flow.md) are available only when the user intentionally chooses the unrestricted workflow. They do not enforce the gated reviewer's tool policy. For independent research see [research assignments](references/research.md); extra agents still need task authorization.

Keep profiles, authentication and provider configuration unchanged. Native reviewer settings are per-process overrides; its existing account authentication remains in use. Do not copy tokens or use another provider as a fallback. A local tool-inventory audit is pinned to the inspected Codex binary and settings; a mismatch blocks before any worker or reviewer model execution.

Count actual provider request records, launcher/reviewer/worker usage, corrections and reporting. Review invocations are not proven provider-response counts. Cached input and reasoning are subsets, not extra totals. Missing usage remains incomplete; billing remains unmeasured. Offline replay and tool denial tests do not establish live quality, token savings, OS isolation or a fixed end-to-end response count.
