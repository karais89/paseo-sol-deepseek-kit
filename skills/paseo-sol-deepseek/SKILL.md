---
name: paseo-sol-deepseek
description: Coordinate development in Paseo with Sol 6.1 and OpenCode Merge Gateway DeepSeek V4.1 Flash workers when the user requests this team or delegates implementation to DeepSeek. Use for the Sol + DeepSeek workflow, not for ordinary solo coding or managing Paseo configuration.
---

# Paseo Sol + DeepSeek

Sol owns the task contract, logical decomposition, final review, and acceptance. DeepSeek owns implementation, behavioral tests, self-review, and first-line fixes. Use the current user task and repository instructions. This skill does not change providers, permissions, host configuration, or deployment scope.

## Plan and launch

- Read repository instructions and only the smallest relevant source slice needed to define scope, dependencies, protected files, and acceptance checks. Delegate broad codebase exploration, alternative-design research, and implementation discovery to DeepSeek; do not preload repository trees, long source files, or full logs into Sol just to prepare the contract. Do not solve the implementation before delegating. Decompose logically; a plan item does not require its own agent or reviewer.
- Default to one persistent end-to-end DeepSeek worker. Use a second only for independently editable scopes with meaningful parallel work. Do not add a separate review worker by default.
- For substantial code/document/web research or uncertain implementation direction, use a dedicated research worker before implementation or in parallel with independent work. See [research assignments](references/research.md) when this applies. Profile count does not limit agent count; the same worker profile can launch distinct research and implementation sessions. Do not claim the earlier single-worker measurements validate this topology.
- Keep planning and final review in the same Sol agent and conversation. Do not create a fresh Sol reviewer or resend the original contract, initial source, and plan in full. If the session cannot be resumed, disclose the context reset and supply the necessary context; do not silently omit requirements.
- Call Paseo `list_profiles`, read the notes, and select `deepseek41-worker`: provider `opencode`, model `merge-gateway/deepseek/deepseek-v4.1-flash`. Use `sol61-orchestrator` for the coordinator. Do not substitute the similarly named lean profiles or another model silently. Missing or unavailable required profiles are a blocker.
- A profile supplies launch settings, not a role prompt. `create_agent` has no profile argument: combine provider/model in `provider`; copy `modeId`, `thinkingOptionId`, and `featureValues` into `settings.modeId`, `settings.thinkingOptionId`, and `settings.features`. Use only exposed settings.
- Use Paseo `create_agent`, not Codex-native subagents. On your host omit `workspaceId` to use the current workspace. On another host resolve `serverId` and the destination workspace first; retain agent and server IDs together. Use worktrees when isolation benefits the task.
- Use `notifyOnFinish:true` for creation and follow-ups. Reuse the same worker through `send_agent_prompt` for routine corrections.

## Worker contract

Send one self-contained assignment containing:

- The outcome, relevant context, logical work units and dependencies, owned files/modules, protected files, and acceptance criteria. Give source/test paths where known; avoid recursive dependency listings and large irrelevant command output.
- Validation commands and any required new behavioral tests. The worker investigates, implements, runs checks, inspects its changes, and repairs failures within scope without asking Sol to approve every step.
- Other agents may share the repository: preserve their edits and do not revert unrelated changes. No extra agents or model changes. Report an unresolved blocker with the failed action and evidence.
- A concise completion report, normally at most eight bullets: changed-file paths and diff summary, implemented behavior, actual checks with exit codes, self-review findings, and unresolved issues. Keep full logs and large diffs in artifacts; return precise paths/line references and only the failure excerpts needed for acceptance. Do not claim unrun checks.

## Event-driven waiting

This section governs Paseo worker notifications, not waiting for your own active shell command.

While the worker runs, do useful independent coordination only. Do not repeat its implementation, add a duplicate broad test suite, or invent work to occupy the wait.

When no independent work remains, immediately end the turn with a short response such as `워커에 위임했으며 완료 알림을 기다립니다.` This yields control to Paseo; completion, errors, permissions, or user input resume the task.

Do not keep the turn alive with status/activity/log polling, wait/sleep tools, shell sleeps, progress prompts, schedules, or heartbeats. Inspect status for a concrete blocker, an explicit user request, **or an actual finish notification that needs confirmation**. Follow-up corrections use the same notification/idle behavior.

`notifyOnFinish` is a wake-up signal, not proof that the requested work and checks finished: a premature idle/finish event is possible. On notification, make one bounded inspection of the worker's final report and necessary status/activity evidence before review. If the worker has not delivered the contract's result, preserve its ID/session and mark the task incomplete; resume the **same** worker with a concrete follow-up and `notifyOnFinish:true` if appropriate. Do not conclude success from a `finished` label alone.

If a finish notification never arrives, an idle Sol turn cannot detect that loss on its own. Do not promise automatic recovery or silently start a periodic Sol poll. Only when the user requests recovery, a concrete failure is reported, or an independently configured external watcher signals a problem, inspect the worker once and re-arm notification by a bounded follow-up if needed. Without such a trigger, automatic wake-up is not guaranteed; report this limit.

For nested coordinator runs in Paseo 0.13 with an outer controller, obtain recipient agent/server IDs in the launch assignment. An interim idle response can reach the outer controller as a finish notification. After final acceptance send one explicit `send_agent_prompt` completion report to that recipient with `notifyOnFinish:false`; first verify the recipient server with `list_hosts`. Do not send that report at initial delegation, guess a recipient, or replace notifications with polling. This workaround was checked in one nested run and is not a general version guarantee.

## Review and accept

- Resume the same Sol session after completion. A worker completion notification triggers review; it does not establish acceptance. Check the actual changes against the original contract, required test delivery, boundaries, integration, and relevant failure cases.
- First inspect the worker's bounded report, change summary, actual checks, and relevant diff against the task's recorded starting revision (including staged changes). Include new untracked source/test files once when necessary. Preserve unrelated initial edits and identify worker-owned changes. Do not load the entire repository or both full modified files and their diffs by default; request precise surrounding context or full source only when the patch is insufficient for safety or acceptance.
- Use actual commands and exit codes as test evidence. Successful output can be omitted; retain relevant failures and assertion results. Exit zero alone does not prove a reproduction checks the claimed behavior. Do not count timeout, execution error, or missing evidence as a pass.
- Run proportionate independent checks for important behavior or missing evidence. Do not automatically repeat the worker's entire investigation. Do not remove required checks to meet a token target; obtain missing evidence before acceptance.
- Send concrete defects, reproduction, and acceptance criteria to the existing worker. Default to one bounded corrective round followed by review in the same Sol session. If still unresolved, report the blocker and decide a justified next step; do not silently loop. Sol can take over for a difficult defect, integration problem, or worker unavailability, stating the reason.
- Request an additional review worker when the user asks or a specific unresolved risk warrants an independent opinion. Its output is advisory; Sol retains final acceptance. A review-only assignment needs enforced read/reproduction permissions and isolated scratch when execution is needed. A Build-mode prompt saying "do not edit" is not an enforced boundary.
- For an automated handoff, distinguish provider response completion from a literal completion marker and from successful validation. Accept only an unambiguous validated structured report as a structured decision. Natural-language review can be passed as unvalidated reference material with decision unknown; malformed or conflicting decisions are not approval. Surface failed handoffs and never label an unfinished pipeline successful.
- Report outcome, observed checks, and remaining limitations in Korean. Separate worker claims from independent verification. Normal operation has planning/delegation and final review as two Sol stages, not a guaranteed two provider requests. Count tools, context requests, errors, and corrections as actual usage.

## Measurement and invocation

Compare Sol total tokens including cached input against a comparable solo baseline; report cached/noncached input, output, worker usage, request purposes, elapsed time, and requirement results separately. Include auxiliary worker requests when measuring total worker usage. Reasoning included in output must not be counted again. Missing usage means incomplete accounting. Do not export secrets or prompt/response bodies to measurement logs.

Same-session reuse does not guarantee cache hits. Do not equate cross-provider token sums with billing or claim replay measurements prove end-to-end production savings. For changes to this workflow, use the paired real-run acceptance procedure in [pre-merge validation](../../docs/pre-merge-validation.md), including quality and elapsed-time checks; do not treat unit tests or instruction-only changes as measured token savings.

Select `sol61-orchestrator` and invoke `$paseo-sol-deepseek` with the actual task. Selecting a profile alone does not invoke this skill. The coordinator reads the skill; the worker receives relevant instructions in its assignment.
