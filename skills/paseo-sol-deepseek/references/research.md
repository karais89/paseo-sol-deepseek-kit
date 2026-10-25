# Dedicated research workers

Use a research worker when understanding a codebase, comparing technical approaches, or collecting authoritative documentation is substantial enough to change implementation decisions. For a small local fix, the implementation worker can investigate directly.

Sol defines the question, scope, decision criteria, and required evidence. The research worker owns detailed source inspection, documentation/web research, alternatives, and a concise handoff. Sol reviews important assumptions and routes the outcome to implementation rather than repeating the whole investigation.

Reuse `deepseek41-worker` launch settings for a separate research session when suitable; a separate named profile is not required. Before assigning web research, verify actual search/browsing access. Before claiming enforced read-only operation, verify the provider's available permission controls or mode. The Build profile plus an edit-prohibition prompt alone does not enforce read-only access. If an appropriate tool or boundary is unavailable, report it and narrow or reroute the assignment explicitly.

Parallelize independent research questions or investigation that cannot invalidate ongoing implementation. If implementation depends on the research conclusion, complete that investigation first. Assign disjoint questions and a meaningful handoff; do not create a worker for each file or repeatedly re-research the same source. Do not add regular Sol progress polls.

A research contract should specify:

- Question, bounded code/document scope, known context, decision criteria, and dependent work.
- Whether the worker is only inspecting, and the available/enforced read, search, and reproduction permissions. Preserve the shared repository; use isolated scratch if authorized reproduction needs generated files.
- A concise result: conclusion, verified facts with source URLs or code file/line references, alternatives and tradeoffs, uncertainty, and recommended implementation/validation points. Distinguish source facts from inference; say what could not be checked.

Do not send whole websites, command transcripts, repository inventories, or dependency trees back to Sol. Preserve the evidence needed to check the conclusion. Research worker completion is evidence delivery, not approval of the eventual implementation. Sol retains final acceptance after implementation and tests.
