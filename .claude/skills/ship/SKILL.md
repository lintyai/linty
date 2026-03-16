---
name: ship
user-invocable: true
disable-model-invocation: false
description: Automates the complete shipping workflow after code changes are ready. Creates Colbin knowledge doc, git branch, commits changes, and opens PR. Triggers on "ship this", "create PR", "commit and push", "ship it", "ready to merge", "create PR for this".
---

# Ship Workflow

Automates the full shipping process: Colbin knowledge doc creation, branch setup, commit, and PR.

## When to Use

Run `/ship` after you've completed code changes and are ready to:
- Create a Colbin knowledge document to track the work
- Commit your changes with proper formatting
- Open a PR for review

## Workflow Steps

Execute these steps IN ORDER. Do not skip steps.

---

### Step 1: Analyze Changes

First, understand what was changed:

```bash
# Check current branch and status
git status

# See the diff of changes (staged and unstaged)
git diff
git diff --cached

# Check current branch name
git branch --show-current

# Recent commit history for context
git log --oneline -5
```

From the conversation context and git diff, identify:
- **What changed**: Files modified, features added/fixed
- **Why it changed**: The problem being solved
- **Type of change**: feat, fix, refactor, docs, chore, test
- **Scope**: Which workspace(s) affected (api, web, block-editor, magic-input, shared-types)

---

### Step 2: Sync with Main

Always sync with the latest changes from origin/main before proceeding:

```bash
# Fetch latest changes from origin
git fetch origin main

# If on a feature branch, rebase onto main
git rebase origin/main
```

**If rebase conflicts occur**:
1. Resolve conflicts in affected files
2. Stage resolved files: `git add <files>`
3. Continue rebase: `git rebase --continue`
4. If too complex, abort and merge instead: `git rebase --abort && git merge origin/main`

**If branch already exists on remote**:
```bash
# Pull latest changes from the remote branch first
git pull --rebase origin {branch-name}
```

---

### Step 3: Pre-Ship Checks

Before proceeding, verify the code is sound:

```bash
# Typecheck the affected workspaces
yarn workspace @colbin/api build    # if API was changed
yarn workspace @colbin/web build    # if Web was changed

# Or run full typecheck
yarn typecheck
```

**Checklist**:
- [ ] Build passes for affected workspaces
- [ ] No TypeScript errors
- [ ] No console.log statements in changed files
- [ ] No hardcoded secrets (.env values, API keys)
- [ ] Changes are tested locally

**If build/typecheck fails**: Fix the issues before proceeding. Do NOT ship broken code.

---

### Step 4: Create Colbin Knowledge Document

Use the Colbin MCP to create a knowledge document that tracks this work:

```
mcp__colbin__colbin_create_document with:
- title: Clear, action-oriented title (e.g., "feat(api): Add document versioning endpoint")
- type: "document"
- parentDocumentId: "69a4171aab146a731a14e6f8"
- content: Markdown content (see template below)
```

**Document Content Template**:

````markdown
# {title}

> **Type**: {feat/fix/refactor/docs/chore} | **Status**: Shipping

## Problem
{What issue this solves or what feature this adds}

## Solution
{What was changed and why}

## Files Changed
| File | Action | Description |
|------|--------|-------------|
| `{path}` | {Created/Modified/Deleted} | {purpose} |

## Testing
- {How to verify the changes work}

## Impact
- {What's affected by this change}
- {Any breaking changes? Or "None"}

---
**Status**: Shipped via `/ship`
````

**Important**: Store the document `url` and `slug` from the response. These are needed for the commit message and PR body.

**Note**: If Colbin MCP is unavailable, skip this step and continue — note the skip in the PR body.

---

### Step 5: Create Branch (if on main)

If currently on `main`, create a feature branch:

```bash
git checkout -b {username}/{short-description}
```

**Branch naming**: `{username}/{short-description}` (lowercase, kebab-case)
- Example: `hari/add-document-versioning`
- Example: `hari/fix-share-permission-bug`

Get username from git config:
```bash
git config user.name | tr '[:upper:]' '[:lower:]' | tr ' ' '-'
```

**If already on a feature branch**: Stay on it. Do not create a new branch.

---

### Step 6: Bump App Version

**MANDATORY**: Every PR must bump the version of affected workspace(s). This ensures Sentry releases track each deploy and cached browser bundles are distinguishable from new ones.

#### How versions flow to Sentry releases

| Workspace | Version Source | Sentry Release Tag |
|-----------|---------------|-------------------|
| `apps/editor` | `apps/editor/package.json` → `version` → `vite.config.ts` injects as `VITE_APP_VERSION` | `colbin-editor@{version}` |
| `apps/api` | `apps/api/package.json` → `version` → `process.env.npm_package_version` | `colbin-api@{version}` |

#### Determine which workspaces to bump

From Step 1's analysis, identify affected workspaces:

| Changed files in... | Bump |
|---------------------|------|
| `apps/editor/` | `apps/editor/package.json` |
| `apps/api/` | `apps/api/package.json` |
| `packages/` (shared) | Both `apps/editor/package.json` and `apps/api/package.json` if both consume the package |
| Root config only | Bump the most relevant workspace, or editor if unclear |

#### Bump the patch version

Use `npm version patch --no-git-tag-version` to increment the patch number (e.g., `0.0.77` → `0.0.78`):

```bash
# If editor was changed
cd apps/editor && npm version patch --no-git-tag-version && cd ../..

# If API was changed
cd apps/api && npm version patch --no-git-tag-version && cd ../..
```

**Semver rules**:
- `patch` (default): Bug fixes, small changes, observability improvements
- `minor`: New features, significant enhancements
- `major`: Breaking changes (rare — discuss with team first)

**Always use `--no-git-tag-version`** — we handle git commits ourselves in Step 7.

#### Regenerate yarn.lock after version bumps

After bumping versions, run `yarn install` from the monorepo root to update `yarn.lock` with the new workspace package versions:

```bash
cd /Users/hari/2025/mp/colbin && yarn install
```

**Why**: Yarn lockfile records workspace package versions. Without this step, `yarn.lock` becomes stale and shows as modified after any subsequent `yarn install`.

#### Include version bump in the commit

The bumped `package.json` file(s) **and `yarn.lock`** must be staged in Step 7 alongside the code changes.

---

### Step 7: Commit Changes

Stage and commit with conventional commit format.

**CRITICAL -- Working Directory**: Always use absolute paths or run git commands from the monorepo root (`/Users/hari/2025/mp/colbin`). After running build/typecheck commands, the shell CWD may have changed, causing `git add` with relative paths to fail.

```bash
git add <files>
git commit -m "$(cat <<'EOF'
type(scope): short description

Longer description if needed.

Knowledge Doc: {colbin-doc-url}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Commit types**:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code restructuring
- `docs`: Documentation
- `chore`: Maintenance
- `test`: Tests

**Scope**: The area affected:
- `api` -- Express backend changes
- `web` -- React frontend changes
- `block-editor` -- ProseMirror editor package
- `magic-input` -- Input rules package
- `shared-types` -- Shared type definitions
- `auth`, `document`, `org`, etc. -- Feature-specific scopes

---

### Step 8: Push Branch

```bash
git push -u origin {branch-name}
```

---

### Step 9: Create PR

Use GitHub CLI to create the PR:

```bash
gh pr create --title "type(scope): description" --body "$(cat <<'EOF'
## Summary
- Bullet points of what changed

## Root Cause (for fixes)
Explain why the issue occurred (omit this section for features)

## Impact
- What's affected by this change
- Any breaking changes?

## Test plan
- [ ] Tested locally
- [ ] Build passes (`yarn workspace @colbin/api build` / `yarn workspace @colbin/web build`)
- [ ] No console errors
- [ ] No TypeScript errors

## Knowledge Doc
- [{doc-title}]({colbin-doc-url})

## Release Notes
- [Colbin Release Notes](https://colbin.com/bin/colbin-release-notes-eX1B2xbk)

---
*Shipped by [`/ship`](https://github.com/shekhardtu/colbin/blob/main/.claude/skills/ship/SKILL.md) -- Triggers: "ship this", "create PR", "commit and push", "ship it", "ready to merge"*

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Step 10: Update Colbin Knowledge Document

Update the document with the shipping details:

```
mcp__colbin__colbin_update_document_content with:
- documentSlug: {slug from Step 4 (Create Colbin Knowledge Document)}
- mode: "replace"
- content: Updated markdown with PR link, branch name, and final status
```

Append to the document content:

````markdown
## Shipping Details
| Step | Details |
|------|---------|
| Branch | `{branch-name}` |
| Commit | `{commit-hash}` |
| PR | [#{pr-number}]({pr-url}) |

---
**Status**: Shipped
````

---

### Step 11: Update Release Notes

Append an entry to the shared **Colbin Release Notes** document so all ships are tracked in one place.

**Release Notes Doc**: `colbin-release-notes-eX1B2xbk` ([View](https://colbin.com/bin/colbin-release-notes-eX1B2xbk))

1. First, **read the current release notes** to get existing content:

```
mcp__colbin__colbin_get_document with:
- documentSlug: "colbin-release-notes-eX1B2xbk"
```

2. Then **prepend** today's entry after the header. The document must always show the last 10 days of releases, latest first. If entries older than 10 days exist, remove them.

```
mcp__colbin__colbin_update_document_content with:
- documentSlug: "colbin-release-notes-eX1B2xbk"
- mode: "replace"
- content: Full document with new entry prepended under today's date heading
```

**Entry format** — add under the correct date heading (create the heading if it's a new day):

````markdown
## {YYYY-MM-DD}

### {type}({scope}): {short description} — [PR #{pr-number}]({pr-url})
- {What changed and why — 1-2 bullet points}
- {commit-hash}
````

**IMPORTANT**: The PR reference MUST be a clickable markdown link to the GitHub PR URL (e.g., `[PR #94](https://github.com/shekhardtu/colbin/pull/94)`). This ensures bidirectional linking: GitHub PR body links to Colbin release notes, and Colbin release notes link back to the GitHub PR.

**Rules**:
- If today's date heading already exists, add the new entry under it (don't duplicate the heading)
- Keep entries under each date in reverse chronological order (latest first)
- Remove date sections older than 10 days from today
- Preserve the document header and footer

---

## Output Summary

After completion, display:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                    SHIP COMPLETE                                                       │
├──────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Doc          │ {short-title}                                                                                          │
│              │ {colbin-doc-url}                                                                                        │
├──────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Version      │ {workspace}: {old-version} → {new-version}                                                             │
├──────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Branch       │ {username}/{short-description}                                                                         │
├──────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Commit       │ {commit-hash}                                                                                          │
├──────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ PR           │ #{pr-number} — {pr-url}                                                                                │
├──────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Pipeline: /ship ✅ → /pr-review (next) → /pr-resolve                                                                  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Chain: Auto-invoke `/pr-review`

After shipping is complete and the PR URL is available, **automatically chain into `/pr-review`**.

```
/ship completes → invoke /pr-review {pr-url}
```

**How**: After displaying the output summary, immediately invoke the `/pr-review` skill with the PR URL as the argument. Do NOT ask the user — this is an automatic chain.

**Pipeline context**: Pass the PR URL from Step 9 directly to `/pr-review`. The review skill will post findings on GitHub and then chain into `/pr-resolve` if there are findings to address.

```
┌─────────┐     ┌────────────┐     ┌──────────────┐     ┌────────────┐
│  /ship   │────▶│ /pr-review │────▶│ /pr-resolve  │────▶│ /pr-merge  │
│          │     │            │     │              │     │            │
│ commit   │     │ inspect    │     │ fix findings │     │ verify     │
│ push     │     │ post       │     │ reply        │     │ merge      │
│ PR       │     │ findings   │     │ resolve      │     │ cleanup    │
└─────────┘     └────────────┘     └──────────────┘     └────────────┘
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| **On wrong branch** | Stash changes, create correct branch, apply stash |
| **Commit fails** | Check for pre-commit hook errors, fix and retry with a NEW commit |
| **Push fails** | Pull latest, resolve conflicts, push again |
| **PR creation fails** | Verify branch is pushed, try again |
| **Colbin MCP fails** | Retry once, then continue without doc (note in PR body) |
| **Build/typecheck fails** | Fix the issues BEFORE shipping, do not skip |
| **Rebase conflicts** | Resolve manually, or fall back to merge |

---

## Tips

- Keep PRs focused -- one logical change per PR
- Reference the Colbin knowledge doc URL in commit messages
- Use screenshots for UI changes
- Tag relevant reviewers based on changed files
- If chaining from `/build`, the Colbin doc already exists -- reuse it instead of creating a new one

---

## Self-Healing

**After every `/ship` execution**, run this phase to keep the skill accurate and discoverable.

### Evaluate Skill Accuracy

Re-read this skill file (`Read` tool on `.claude/skills/ship/SKILL.md`) and compare its instructions against what actually happened during this execution:

| Check | What to look for |
|-------|-----------------|
| **MCP tool names** | Did any `mcp__colbin__colbin_*` calls fail because the tool name, parameter name, or syntax changed? |
| **CLI commands** | Did any `gh`, `git`, or `yarn` commands fail due to wrong flags, deprecated syntax, or changed output format? |
| **API responses** | Did any API response structure differ from what the skill expected? |
| **Workflow steps** | Did any step need to be skipped, reordered, or modified to work correctly? |
| **Templates** | Are commit message, PR body, or output templates still accurate? |
| **Tool availability** | Did any referenced tool behave differently than documented? |

### Fix Issues Found

If any discrepancies were found:
1. Use the `Edit` tool to fix the specific inaccurate section in this skill file
2. Keep changes minimal and targeted -- fix only what's wrong
3. Log each fix:

```
Self-Healing Log:
- Fixed: <what was wrong> -> <what it was changed to>
- Reason: <why the original was inaccurate>
```

If nothing needs fixing, skip silently.

### Append Skill Attribution

After execution, ensure the skill attribution is present in:

**PR description** (add via `gh pr edit` if not already present):
```markdown
---
*Shipped by [`/ship`](https://github.com/shekhardtu/colbin/blob/main/.claude/skills/ship/SKILL.md) -- Triggers: "ship this", "create PR", "commit and push", "ship it", "ready to merge"*
```

**Output summary** displayed to the user:
```
Skill: /ship
File:  .claude/skills/ship/SKILL.md
Repo:  https://github.com/shekhardtu/colbin/blob/main/.claude/skills/ship/SKILL.md
```
