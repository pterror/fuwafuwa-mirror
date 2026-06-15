# TODO

- [ ] Pick a Moltbook handle — agent's call
- [ ] Register on Moltbook: `POST /api/v1/agents/register`
- [ ] Rename GitHub repo to match: `gh repo rename pterror/<name>`
- [ ] Update CLAUDE.md with chosen name and why
- [ ] Set `MOLTBOOK_KEY` in `.envrc`
- [ ] Initialize `knowledge.db` schema on first session
- [ ] propagate ecosystem-common region (Ecosystem Design Principles) from github-io CLAUDE.md — see tooling/propagate-claude-md.sh
- [ ] Propagate ECOSYSTEM RULES region: removed main-session-only orchestrator/delegation rules (now in a main-session hook, see rhizone/github-io). This repo was dirty during the 2026-05-30 ecosystem propagation — run `tooling/propagate-claude-md.sh` from github-io against this repo's CLAUDE.md and commit when the tree is clean.

## Pending: sync ecosystem-common CLAUDE.md region (deferred 2026-06-14)

The canonical ecosystem-common region (between `<!-- BEGIN ECOSYSTEM RULES -->` and `<!-- END ECOSYSTEM RULES -->` in `~/git/rhizone/github-io/CLAUDE.md`) was updated (data-over-code principle made conditional; verify-before-assert bullet reworded). This repo was dirty during propagation on 2026-06-14, so it was skipped per the ecosystem-wide refactor rules. Once this repo is clean, run:

```sh
sh ~/git/rhizone/github-io/tooling/propagate-claude-md.sh "$(git rev-parse --show-toplevel)/CLAUDE.md"
```

then commit `CLAUDE.md` with `docs(claude): sync ecosystem-common region (data-over-code principle)`.

## CLAUDE.md ecosystem sync pending (2026-06-15)

Ecosystem-common region updated again (commit 050410c in github-io: refined "At a decision point…" decision-rule Meta bullet, plus the "Prefer data over code" refinement). This repo was dirty at propagation time, so the region was not synced. Re-run when clean:

```sh
sh ~/git/rhizone/github-io/tooling/propagate-claude-md.sh "$(git rev-parse --show-toplevel)/CLAUDE.md"
```

The propagator replaces the whole region from canonical, so this single re-run reconciles every missed edit at once. Commit with `docs(claude): sync ecosystem CLAUDE.md decision-rule region`. (Supersedes the earlier data-over-code sync note above.)


## Pending: ecosystem-rules region sync (deferred — repo was dirty 2026-06-15)

The canonical ecosystem-rules region (github-io commit e678388) dropped two harness-management bullets
("No ecosystem changes without checking all affected repos." and "Control surface stays self-contained and versioned.").
This region sync was deferred because this repo had uncommitted work. Re-run when clean:

```sh
sh ~/git/rhizone/github-io/tooling/propagate-claude-md.sh "$(git rev-parse --show-toplevel)/CLAUDE.md"
git add CLAUDE.md
git commit -m "docs(claude): sync ecosystem rules — drop harness-management bullets"
git push
```
