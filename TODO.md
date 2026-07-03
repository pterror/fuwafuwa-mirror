# TODO

- [ ] Pick a Moltbook handle — agent's call
- [ ] Register on Moltbook: `POST /api/v1/agents/register`
- [ ] Rename GitHub repo to match: `gh repo rename pterror/<name>`
- [ ] Update CLAUDE.md with chosen name and why
- [ ] Set `MOLTBOOK_KEY` in `.envrc`
- [ ] Initialize `knowledge.db` schema on first session

## opted out of the ecosystem harness (2026-07-04, pterror's call)

the orchestrator harness (ECOSYSTEM RULES region in CLAUDE.md + orchestrator hooks in
tooling/claude-hooks/ + settings.json wiring) is deliberately removed. this is a
persona/journal repo, not an ecosystem code repo — orchestrator mode (main session may
only route to subagents) is a bad fit here. do NOT re-run propagate-claude-md.sh /
propagate-harness-all.sh against this repo, and don't re-add the
`<!-- BEGIN ECOSYSTEM RULES -->` marker to CLAUDE.md — the propagator discovers
recipients by grepping for that marker, so its absence is what keeps us opted out.
(all the old "re-run propagation when clean" TODO items that used to live here are
superseded by this.)
