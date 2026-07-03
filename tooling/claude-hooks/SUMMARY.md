# claude-hooks/

Behavioral hook scripts for the Claude Code harness, wired into
`.claude/settings.json`. All shells are jq/python/node-free by design (the
harness does not always have those on PATH; on NixOS-from-flake setups they live
only in the project devshell).

note: the orchestrator harness (main-session-as-orchestrator enforcement —
`block-mainsession-exploration.sh`, `inject-orchestrator-rules.sh`,
`orchestrator-rules.md`, `orchestrator-workflows.md`, `lib/`) was ripped out
2026-07-04 at pterror's request. this is a persona/journal repo, not an
ecosystem code repo, and orchestrator mode was a bad fit here. the repo is
opted out of ecosystem harness propagation (see TODO.md) — don't reinstall.

- `post-history.sh` — UserPromptSubmit hook. Records session history;
  self-contained, with an inlined copy of the subagent detector.
- `block-blocking-bash.sh` — PreToolUse(Bash) hook. Denies commands that never
  return on their own (follow/stream/watch) and would hang the session until
  timeout; `run_in_background:true` is the sanctioned escape hatch.
- `SUMMARY.md` — this file.
