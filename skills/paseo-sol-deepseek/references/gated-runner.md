# Gated host execution

This route separates the host executor from the Sol reviewer. It changes the execution topology from an ordinary, tool-enabled Sol conversation. The launch conversation remains unrestricted; do not hide its usage in an end-to-end comparison or describe its general tools as disabled.

The host does deterministic preparation, launches the existing `deepseek41-worker` through native Paseo tools with its mode/features and the user's model/effort, and collects a complete patch plus the task-required independent checks. Sol 6.1 high receives that evidence through the existing native Codex CLI/account, with shell, apps, MCP-by-user-config, memory injection, host skill discovery, browser, image and multi-agent capabilities disabled for this process. The reviewer runs in the host-owned review directory, never the candidate's configuration directory. The native empty-tool request audit covers initial execution and same-thread resume.

The reviewer returns JSON with exactly `action`, `summary` and `defects`. Each defect has exactly `requirement`, `expected` and `observed`. Actions are `accept`, `correct` and `fail`; there is no shell, file-read, test, wait, profile-edit or arbitrary tool action. The host does not evaluate model text as code or execute strings from a decision. It limits corrections to one, keeps the same worker and reviewer thread, and rejects acceptance when the required tests, diff checks, protected-path checks or starting revision fail or are missing.

The original contract and all evidence remain necessary. These controls prevent direct extra execution by the dedicated reviewer; they do not prove semantic correctness, hostile-worker isolation or complete filesystem/process containment. A cooperative worker still has its existing task permissions. Treat independent grader results separately from the reviewer's decision.

The route uses the `sol61-orchestrator` profile only when it matches the inspected Sol 6.1 high/default-tier route. Native per-process settings use `--ignore-user-config` to exclude broad integrations while retaining the current Codex account's auth. A non-OpenAI native provider, incompatible profile, changed CLI binary, changed policy, failed native tool audit or an existing run directory blocks before launching a worker. No authentication or persistent profile/config file is rewritten. The reviewer creates normal native session history so its second review can resume the same thread.

`scripts/sol-tool-audit.json` contains an offline native request inventory tied to the current Codex executable hash and policy. It used localhost SSE replay with no credentials and no external model requests. It is not live model success. After a Codex update, regenerate and review native initial/resume request evidence before replacing this audit; never bypass a stale audit or fall back to unrestricted execution.

The host makes at most two review invocations, but provider retries, failures or runtime behavior require actual request-level accounting. Do not promise a provider-response count or token reduction before measurement. Keep cached/noncached input, generation, reasoning subsets, worker records, launcher/report responses and billing distinct.

The legacy execution references remain available for an intentional unrestricted workflow. They are not a fallback after gated admission fails.
