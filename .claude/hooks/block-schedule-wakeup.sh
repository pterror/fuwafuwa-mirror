#!/usr/bin/env bash
# PreToolUse hook for ScheduleWakeup. The fuwafuwa heartbeat invokes claude
# with `-p` (one-shot print mode), but ScheduleWakeup only works in /loop
# dynamic mode — calling it here silently no-ops and the session exits
# without ever running `session end`. That orphans brain/session.lock
# (caused the 2026-05-14 stale-lock incident, nonce f628e441).

cat >/dev/null  # drain stdin
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Refused: ScheduleWakeup only works in /loop dynamic mode. The fuwafuwa heartbeat invokes claude -p (one-shot print mode), so this silently no-ops and the session exits without continuation — orphaning brain/session.lock AND losing all in-session context (each timer tick spawns a fresh claude with no memory of what you were waiting on). If you need to wait, poll inline with sleep+check — do NOT exit while mid-thread. Only run session end when truly idle."}}\n'
