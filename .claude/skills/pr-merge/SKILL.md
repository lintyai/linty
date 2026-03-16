---
name: pr-merge
user-invocable: true
disable-model-invocation: false
description: "Safely merge a PR after all checks pass. Verifies CI status, unresolved threads, and approval state before merging. Final step in the /ship -> /pr-review -> /pr-resolve -> /pr-merge pipeline. Triggers on: \"merge PR\", \"merge this\", \"merge it\", \"ready to merge\", \"/pr-merge\"."
---

# PR Merge — Safe Pull Request Merge

Safely merges a PR after verifying all pre-merge conditions are met.

```
/ship -> /pr-review -> /pr-resolve -> /pr-merge
                                       ^ YOU ARE HERE
```

## When to Use

Run `/pr-merge` when:
- All review comments have been resolved
- CI checks are passing
- The PR is ready to merge into main

**Input**: PR number or URL (e.g., `5` or `https://github.com/lintyai/linty/pull/5`)

---

## Phase 1: Pre-Merge Verification

### 1.1 Auth Check
```bash
gh auth status
```

### 1.2 Fetch PR State
```bash
gh pr view <PR_NUMBER> --repo lintyai/linty --json number,title,headRefName,baseRefName,state,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,url,body
```

### 1.3 Verify Merge Conditions

| Check | Pass Criteria | Block on Fail? |
|-------|---------------|----------------|
| **PR is open** | `OPEN` | Yes |
| **Mergeable** | `MERGEABLE` | Yes — resolve conflicts first |
| **CI checks** | All `SUCCESS` or `NEUTRAL` | Yes — wait for CI |
| **No unresolved threads** | 0 unresolved threads | Yes |
| **Branch up to date** | `CLEAN` or `HAS_HOOKS` | Warn — suggest rebase |

### 1.4 Check Unresolved Threads

```bash
gh api graphql -f query='
{
  repository(owner: "lintyai", name: "linty") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          comments(first: 1) {
            nodes { body path line }
          }
        }
      }
    }
  }
}'
```

### 1.5 Check CI Status

```bash
gh pr checks <PR_NUMBER> --repo lintyai/linty
```

---

## Phase 2: Merge Decision

### Pre-Merge Summary

```
┌──────────────────────────────────────────────────┐
│              PRE-MERGE CHECKLIST                  │
├──────────────────────────────────────────────────┤
│ PR:              #{number} — {title}             │
│ Branch:          {head} -> {base}                │
│ Mergeable:       PASS / FAIL                     │
│ CI Checks:       PASS / FAIL                     │
│ Unresolved:      0 / {N} threads                 │
│ Branch Status:   CLEAN / BEHIND                  │
├──────────────────────────────────────────────────┤
│ Verdict:         READY TO MERGE / BLOCKED        │
└──────────────────────────────────────────────────┘
```

---

## Phase 3: Execute Merge

```bash
gh pr merge <PR_NUMBER> --repo lintyai/linty --squash --delete-branch
```

### If Merge Fails

| Error | Action |
|-------|--------|
| Merge conflicts | Suggest `git rebase origin/main` and re-push |
| Required reviews missing | Suggest requesting review |
| CI still running | Wait 30s, retry once |

---

## Phase 4: Post-Merge

```bash
# Verify merge
gh pr view <PR_NUMBER> --repo lintyai/linty --json state,mergedAt,mergeCommit

# Update local
git checkout main
git pull origin main
```

---

## Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MERGE COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PR:       #{number} — {title}
Merged:   {head} -> {base}
Commit:   {merge-commit-sha}
Branch:   {head} — deleted

Pipeline: /ship -> /pr-review -> /pr-resolve -> /pr-merge

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /pr-merge
File:  .claude/skills/pr-merge/SKILL.md
```

---

## Guidelines

- **NEVER force merge** — if there are conflicts or failures, report and stop
- **NEVER skip CI checks**
- **ALWAYS verify merge succeeded**
- **Squash merge is default** — keeps main branch clean
- **Delete branch after merge**
