# Agent instructions

This repo is early / undefined. Prefer asking over inventing product scope,
architecture, or SDK choice until the human spells it out.

## Commit convention (MUST FOLLOW)

Same lightweight convention as `temporalio/sdk-python` (and
`temporal-production-local`):

- Imperative, sentence case. "Add X", not "Added X" / "adds X" / "add x".
- No trailing period. Subject under ~72 chars.
- No Conventional Commits types (`feat:` / `fix:` / `chore:` / …).
- Optional lowercase scope prefix when it clarifies (`docs:`, `ci:`, a component).
- Body optional; wrap ~72 cols; explain *why*, not what.

`prepare-commit-msg` strips `Co-authored-by:` trailers agents inject.
Do not add agent co-author attribution.

## Pre-commit sensitive-content check (MUST)

Internal Temporal work that may become public. `.githooks/pre-commit` scans
staged *added* lines for secrets and company-sensitive material:

1. Deterministic regex (generic secret shapes + optional local denylist).
2. AI review via `claude` CLI when installed.

After clone, hooks are not auto-enabled. Run once:

```
git config core.hooksPath .githooks
```

Org-specific markers live in `.githooks/patterns.local` (gitignored, never
committed). Add new markers there, not in the committed hook.

Escape hatches (false positives only, your call):

- `git commit --no-verify`
- `SKIP_SENSITIVE_CHECK=1 git commit …`
- `SENSITIVE_CHECK_MODEL=<id> git commit …`

## Commit & push workflow

Local-only for now (no remote assumed). When a remote exists and the user asks
to commit and push, default to a PR off `main` rather than pushing straight to
`main`, unless they explicitly say otherwise.

## Scope guard

Do not scaffold apps, Workers, compose stacks, or docs beyond what the human
asked for. This folder was seeded with git + agent/hook hygiene only.

## Manual browser validation

Safari and Island are available for manual UI and end-to-end testing through direct Mac app control.
If the browser runtime reports that no browser is connected, use Computer Use with Safari first and Island as the fallback.
Do not report manual browser validation as pending solely because the browser runtime cannot discover a browser.
Start the local development server, open its URL in a new browser tab, run the requested scenarios, and inspect screenshots and accessibility state.
