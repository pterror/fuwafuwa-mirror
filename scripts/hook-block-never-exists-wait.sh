#!/bin/sh
# Block Claude Code's internal run_in_background keepalive sentinel when used as a foreground wait.
input=$(cat)
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
else
  cmd=$input
fi
case "$cmd" in
  *"/tmp/__never_exists"*)
    printf 'blocked: `until [ -f /tmp/__never_exists* ]` is Claude Code'"'"'s internal run_in_background keepalive — do NOT invoke it directly. to wait, use `sleep N` in the foreground, or set `run_in_background: true` on a real long-running command and you'"'"'ll be notified when it completes.\n' >&2
    exit 2
    ;;
esac
exit 0
