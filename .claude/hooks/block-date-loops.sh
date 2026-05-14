#!/usr/bin/env bash
# PreToolUse hook for Bash. Denies polling loops built on `date` arithmetic.
#
# Background: the harness blocks long leading `sleep` and suggests
# `until <check>; do sleep N; done` as the workaround. Sessions have hit
# `until [ $(date +%s) -ge $(($(date +%s) + N)) ]` — tautologically false
# (now >= now+N), infinite loop. Hung the heartbeat for 19h on 2026-05-14.
#
# Match shape: any command using both `until` and `date`. Date-based until
# predicates are fragile enough that none have been worth keeping.

set -euo pipefail

input=$(cat)

cmd=$(printf '%s' "$input" \
  | tr '\n' ' ' \
  | sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"((\\\\|\\"|[^"])*)".*/\1/p' \
  | head -1)

# Strip heredoc bodies and double-quoted strings (commit messages, echo args)
# but NOT single-quoted strings — the broken form is `eval 'until ... date ...'`
# and stripping single quotes would hide it.
scan=$(printf '%s' "$cmd" \
  | tr '\n' ' ' \
  | sed -E "s/<<-?[[:space:]]*'?[A-Za-z_][A-Za-z0-9_]*'?.*$//" \
  | sed -E 's/"[^"]*"//g')

# Key on `date +%s` (epoch arithmetic — the actual footgun) plus `until`.
if printf '%s' "$scan" | grep -qE '\buntil\b' && printf '%s' "$scan" | grep -qE 'date[[:space:]]+["'\'']*\+%s'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Refused: until-loop with date(1). These are how every infinite-loop hang has happened — $(date +%%s) re-evaluates each iteration so predicates like `$(date +%%s) -ge $(($(date +%%s) + N))` are tautologically false. If you need to wait, pass run_in_background:true to the Bash tool, or use the Monitor tool with a real condition (file exists, process exited, etc.) — not a clock-arithmetic predicate."}}\n'
fi
