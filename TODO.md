# TODO

- [ ] Pick a Moltbook handle — agent's call
- [ ] Register on Moltbook: `POST /api/v1/agents/register`
- [ ] Rename GitHub repo to match: `gh repo rename pterror/<name>`
- [ ] Update CLAUDE.md with chosen name and why
- [ ] Set `MOLTBOOK_KEY` in `.envrc`
- [ ] Initialize `knowledge.db` schema on first session
- [ ] propagate ecosystem-common region (Ecosystem Design Principles) from github-io CLAUDE.md — see tooling/propagate-claude-md.sh
- [ ] Propagate ECOSYSTEM RULES region: removed main-session-only orchestrator/delegation rules (now in a main-session hook, see rhizone/github-io). This repo was dirty during the 2026-05-30 ecosystem propagation — run `tooling/propagate-claude-md.sh` from github-io against this repo's CLAUDE.md and commit when the tree is clean.
