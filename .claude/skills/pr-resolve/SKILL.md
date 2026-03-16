---
name: pr-resolve
user-invocable: true
disable-model-invocation: false
description: "Resolve PR review comments, check for issues, commit fixes and push. Resolves reviewer comments, performs proactive code quality analysis, validates builds, replies to threads, and marks them resolved on GitHub. Triggers on: \"resolve PR\", \"fix PR comments\", \"address PR feedback\", \"resolve PR comments\", \"/pr-resolve\"."
---

# PR Resolve — Pull Request Resolution & Review

Resolves reviewer comments **and** performs proactive code quality analysis, build validation, threaded replies, and re-review requests.

```
/ship -> /pr-review -> /pr-resolve -> /pr-merge
                        ^ YOU ARE HERE
```

## When to Use

Run `/pr-resolve` when:
- You receive review comments on a PR
- You want a code quality check on an open PR
- You need to resolve, reply, and re-request review in one pass

**Input**: PR number or URL (e.g., `https://github.com/lintyai/linty/pull/5`)

---

## Phase 1: PR Analysis & Setup

### 1.1 Auth & Metadata
```bash
gh auth status
gh pr view <PR_NUMBER> --repo lintyai/linty --json number,title,headRefName,baseRefName,author,state,url,body
gh pr diff <PR_NUMBER> --repo lintyai/linty
gh pr checkout <PR_NUMBER>
```

### 1.2 Fetch Comments & Reviews
```bash
gh api repos/lintyai/linty/pulls/{pr_number}/comments --paginate
gh api repos/lintyai/linty/issues/{pr_number}/comments --paginate
gh api repos/lintyai/linty/pulls/{pr_number}/reviews --paginate
```

### 1.3 Fetch Review Threads
```bash
gh api graphql -f query='
{
  repository(owner: "lintyai", name: "linty") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 10) {
            nodes {
              id
              body
              path
              line
              author { login }
            }
          }
        }
      }
    }
  }
}'
```

---

## Phase 2: Comment Evaluation & Triage

For **each** review comment, verify the claim against actual code:

### 2.1 Verify Against Code

1. Read the referenced code in full context
2. Check if the issue actually exists
3. Check against CLAUDE.md conventions
4. Check if already addressed in subsequent commits

### 2.2 Classify

| Status | Meaning | Auto-resolve? |
|--------|---------|---------------|
| **RESOLVED** | Will fix with code changes | Yes |
| **ALREADY FIXED** | Current code already satisfies | Yes |
| **NOT APPLICABLE** | Based on misunderstanding | No |
| **NEEDS CLARIFICATION** | Ambiguous | No |
| **DEFERRED** | Valid but out of scope | No |
| **DISAGREE** | Technically incorrect | No |

### 2.3 Priority Ordering

1. Security/correctness issues
2. Bug-introducing feedback
3. Type safety issues
4. Logic/behavior changes
5. Naming/style suggestions

---

## Phase 3: Implementation

For each **RESOLVED** comment:

1. Understand the reviewer's intent
2. Plan the minimal change needed
3. Follow existing code patterns

### Commit Strategy

```
fix(scope): address PR review — brief description

- Comment by @reviewer: what was changed

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Stage only specific files: `git add <specific-files>` (never `git add .`)

---

## Phase 4: Proactive Code Quality Scan

After addressing reviewer comments, scan changed files:

**Critical (must fix):**
- [ ] `console.log` statements
- [ ] `any` type usage
- [ ] `.unwrap()` in Rust production code
- [ ] Hardcoded secrets

**High (should fix):**
- [ ] Missing error handling on async ops
- [ ] Mutex held across await
- [ ] Wrong entitlement keys

**Convention violations:**
- [ ] File naming convention
- [ ] Import order
- [ ] ID fields without entity prefix

---

## Phase 5: Build Validation

```bash
# Frontend
yarn build

# Rust
cd src-tauri && cargo check --features local-stt
```

---

## Phase 6: Push Changes

```bash
git push origin <branch-name>
```

---

## Phase 7: Reply to PR Threads

Reply to **every** comment thread:

**RESOLVED:** `Fixed in <commit-hash>. <explanation>.`
**ALREADY FIXED:** `Already addressed — <evidence>. Resolving.`
**NOT APPLICABLE:** `After reviewing, this doesn't apply because <reasoning>.`
**NEEDS CLARIFICATION:** `Could you clarify <specific question>?`
**DEFERRED:** `Valid point — outside scope of this PR, noted for follow-up.`

### Post Replies

```bash
gh api repos/lintyai/linty/pulls/{pr_number}/comments/{comment_id}/replies \
  -X POST \
  -f body='Your reply here'
```

---

## Phase 8: Resolve Threads

Resolve threads for RESOLVED and ALREADY FIXED comments only:

```bash
gh api graphql -f query='
  mutation {
    resolveReviewThread(input: {threadId: "THREAD_NODE_ID"}) {
      thread { isResolved }
    }
  }
'
```

---

## Phase 9: Request Re-Review

```bash
gh pr edit <PR_NUMBER> --add-reviewer <reviewer1>
```

### Summary Comment

```bash
gh pr comment <PR_NUMBER> --repo lintyai/linty --body '## PR Review Comments Addressed

| Status | Count |
|--------|-------|
| Resolved | X |
| Already Fixed | X |
| Not Applicable | X |

**Commits pushed:**
- `abc1234` — fix(scope): description

Ready for re-review.'
```

---

## Chain: Auto-invoke `/pr-merge`

After all threads resolved and build passes, chain into `/pr-merge`.

| Outcome | Chain? |
|---------|--------|
| All resolved, build passes | Yes — `/pr-merge` |
| NEEDS CLARIFICATION remains | No |
| Build fails | No |
| DISAGREE remains | No |

---

## Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PR RESOLUTION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PR: <url>
Branch: <name>

Total Comments: X
  Resolved: X
  Already Fixed: X
  Not Applicable: X

Build: PASS / FAIL
Threads Resolved: X/Y
Re-review requested: @reviewer

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /pr-resolve
File:  .claude/skills/pr-resolve/SKILL.md
```
