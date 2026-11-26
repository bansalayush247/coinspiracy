# Adoption Plan

> **Generated**: 2026-11-26
> **Project phase**: Production (inferred: no `project.stage`; about 400 TypeScript source files)
> **Engine**: Not configured (actual stack: Web, TypeScript, Phaser 3 client, Colyseus server, Vite, npm workspaces)
> **Template version**: v1.0+ (framework 1.3.0)
> **Workflow tier**: minimal (review mode solo, automation collaborative)

Work through these steps in order. Check off each item as you complete it.
Re-run `/adopt` anytime to check remaining gaps.

---

## Step 1: Fix Blocking Gaps

None found. `project.yaml` exists, so no v1.0 config migration is needed.

---

## Step 2: Fix High-Priority Gaps

### 2a. Record the engine and language
**Problem**: `project.yaml` has no `engine` block and `.claude/docs/technical-preferences.md` is all placeholders, so
engine-aware skills can't tell this is a web project.
**Fix**: run `/setup-engine` and choose Web, TypeScript, Phaser 3 (the reference docs in `docs/engine-reference/web/`
are already present). Note the server side (Colyseus on Node) and the Astro site in the answers.
**Time**: 5 min
- [x] `engine.name`, `engine.language` and `engine.version` set in `project.yaml` (by hand, 2026-11-26: `/setup-engine` stops on npm workspaces, so `CLAUDE.md`, `technical-preferences.md` and `project.yaml` were written directly)

### 2b. Write the game brief
**Problem**: at the minimal tier `design/game-brief.md` is the whole design record, and it doesn't exist.
**Fix**: write it from `.claude/docs/templates/game-brief.md`, filling the six required fields (Pitch, Core loop,
Goal & fail state, Features, Out of scope, Build order) from the original plan, `docs/world.md` and
`docs/progression.md`. Don't rewrite those docs; link to them.
**Time**: 30 min
- [x] `design/game-brief.md` written with all six required fields (2026-11-26)

---

## Step 3: Bootstrap Infrastructure

Not on the minimal path: the brief's build order is the plan. Next: `/create-stories` (or `/dev-story` once stories
exist).

---

## Step 4: Medium-Priority Gaps

### 4a. Point the template at the real code and test folders
**Problem**: the template's web defaults expect code in `src/` and tests in `tests/unit/` and `tests/integration/`.
This repo is a monorepo: code in `apps/client/src`, `apps/server/src`, `apps/site/src` and `packages/shared/src`;
tests in `apps/*/test`, `packages/shared/test` and `e2e/`.
**Fix**: set `engine.code_root` and `engine.test_root` in `project.yaml` (via `/project-settings`), or note the layout
in the brief if one root per setting can't describe it. Don't move files: the workspaces, Vite and Vitest configs
depend on the current layout.
**Time**: 5 min
- [x] code and test roots recorded (`engine.code_root: "."`, `engine.test_root: "packages/shared/test"`; the other test folders are listed above)

---

## Step 5: Optional Improvements

### 5a. Leave the existing design docs in their own format
`docs/world.md`, `docs/progression.md`, `docs/deploy.md` and `CHANGELOG.md` predate the template. They work as they
are; link them from the brief rather than converting them.
- [ ] linked from `design/game-brief.md`

---

## Open decision: whose rules win

The template's `CLAUDE.md` and coding standards differ from the rules already in force on this project. The owner
chose to mix them; until each is decided, the existing rule applies:

| Topic | Template | Existing rule |
|---|---|---|
| Writing files | Ask before each file; approve multi-file changesets | "continue" builds the next piece |
| Comments | Doc comments on public APIs | At most one line, only above non-obvious functions |
| Gameplay values | External config files | Tested constants in `packages/shared` |
| Visual evidence | Screenshots kept in `production/qa/evidence/` | Screenshots in git-ignored `.scratch/e2e/` |
| Commits | Conventional Commits with a task ID | Conventional Commits, no task IDs; commit only when asked |

---

## What to Expect from Existing Stories

There are no template stories yet. Existing work is tracked in `CHANGELOG.md` and git history.

---

## Re-run

Run `/adopt` again after completing Step 2 to verify all high gaps are resolved. Start Claude Code inside
`byzantine-council/` so the template's hooks and slash commands load.
