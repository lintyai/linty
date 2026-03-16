---
name: ship
user-invocable: true
disable-model-invocation: false
description: Automates the complete shipping workflow after code changes are ready. Creates git branch, commits changes, and opens PR. Optionally chains into /pr-review. Triggers on "ship this", "create PR", "commit and push", "ship it", "ready to merge".
---

# Ship Workflow

Automates the full shipping process: branch setup, pre-ship checks, commit, push, and PR creation.

## When to Use

Run `/ship` after you've completed code changes and are ready to:
- Commit your changes with proper formatting
- Open a PR for review

---

### Step 1: Analyze Changes

```bash
git status
git diff
git diff --cached
git branch --show-current
git log --oneline -5
```

From the diff, identify:
- **What changed**: Files modified, features added/fixed
- **Why**: The problem being solved
- **Type**: feat, fix, refactor, docs, chore
- **Scope**: frontend, rust, tauri, config

---

### Step 2: Sync with Main

```bash
git fetch origin main
git rebase origin/main
```

If conflicts occur, resolve them before proceeding.

---

### Step 3: Pre-Ship Checks

```bash
# Frontend build
yarn build

# Rust check
cd src-tauri && cargo check --features local-stt && cd ..
```

**Checklist:**
- [ ] Build passes (frontend + Rust)
- [ ] No TypeScript errors
- [ ] No console.log in changed files
- [ ] No hardcoded secrets
- [ ] No `.unwrap()` in new Rust code

**If build fails**: Fix before shipping. Do NOT ship broken code.

---

### Step 4: Create Branch (if on main)

```bash
git checkout -b {username}/{short-description}
```

**Branch naming**: `{username}/{short-description}` (lowercase, kebab-case)
- Example: `hari/add-noise-cancellation`
- Example: `hari/fix-mic-permission`

Get username:
```bash
git config user.name | tr '[:upper:]' '[:lower:]' | tr ' ' '-'
```

**If already on a feature branch**: Stay on it.

---

### Step 5: Commit Changes

```bash
git add <specific-files>
git commit -m "$(cat <<'EOF'
type(scope): short description

Longer description if needed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Commit types**: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`

**Scope**: The area affected:
- `frontend` — React/TypeScript changes
- `rust` — Rust backend changes
- `audio` — Audio capture pipeline
- `transcribe` — Transcription (whisper/Groq)
- `macos` — macOS FFI, permissions, entitlements
- `clipboard` — Clipboard/paste pipeline
- `capsule` — Overlay panel
- `tauri` — Tauri config, IPC wiring
- `build` — Build scripts, CI

---

### Step 6: Push Branch

```bash
git push -u origin {branch-name}
```

---

### Step 7: Create PR

```bash
gh pr create --repo lintyai/linty --title "type(scope): description" --body "$(cat <<'EOF'
## Summary
- Bullet points of what changed

## Impact
- What's affected
- Breaking changes? Or "None"

## Test plan
- [ ] Tested locally with `yarn tauri dev`
- [ ] Build passes (`yarn build` + `cargo check`)
- [ ] Tested from Finder (not just Terminal) if macOS permissions involved
- [ ] No console errors

---
*Shipped by `/ship`*

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Output Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SHIP COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Branch:   {username}/{short-description}
Commit:   {commit-hash}
PR:       #{pr-number} — {pr-url}

Pipeline: /ship -> /pr-review (next)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Chain: Auto-invoke `/pr-review`

After shipping, automatically chain into `/pr-review` with the PR URL.

```
/ship -> /pr-review -> /pr-resolve -> /pr-merge
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| On wrong branch | Stash, create correct branch, apply stash |
| Commit fails | Check pre-commit hooks, fix and retry with NEW commit |
| Push fails | Pull latest, resolve conflicts, push again |
| PR creation fails | Verify branch is pushed, try again |
| Build fails | Fix before shipping |

---

## Tips

- Keep PRs focused — one logical change per PR
- Use screenshots for UI changes
- If chaining from `/build`, reuse existing context
- Always test macOS permission changes from Finder, not Terminal

Skill: /ship
File:  .claude/skills/ship/SKILL.md
