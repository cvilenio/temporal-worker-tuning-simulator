# Contributing

## Pre-commit sensitive-content check

This repo may hold internal Temporal work that becomes public, so a pre-commit
hook guards against leaking company-sensitive material (internal hostnames,
architecture, dashboards, customer data, credentials, hiring/interview
references). It lives at [`.githooks/pre-commit`](.githooks/pre-commit) and
reviews the added lines of each staged commit in two layers: a fast
deterministic pattern scan, and an AI review via the
[`claude`](https://docs.claude.com/en/docs/claude-code) CLI (skipped if
`claude` is not installed). A hit in either layer blocks the commit.

Git does not enable repo-tracked hooks automatically. **After cloning, run once:**

```
git config core.hooksPath .githooks
```

The committed deterministic list is intentionally **generic** (only universal
secret shapes). Keep org- or project-specific markers in a local denylist that
is **gitignored and never committed**:

```
# .githooks/patterns.local  — one POSIX extended-regex per line, '#' lines ignored
your-internal-domain-fragment
internal-project-name
```

The hook loads `.githooks/patterns.local` automatically if present. Add new
markers there, not to the committed hook.

Escape hatches (use your judgement — a block can be a false positive):

- `git commit --no-verify` — bypass for one commit
- `SKIP_SENSITIVE_CHECK=1 git commit …` — bypass via environment
- `SENSITIVE_CHECK_MODEL=<model-id> git commit …` — override the AI model

## Commit conventions

See [`AGENTS.md`](AGENTS.md). Imperative sentence-case subjects, no Conventional
Commits types, optional loose scope prefix.
