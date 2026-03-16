---
name: pr-review
user-invocable: true
disable-model-invocation: false
description: Deep PR review from a principal engineer's perspective. Multi-stage pipeline (Triage -> Specialized Passes -> Filter -> Output) with risk classification, security pass, and line-level GitHub comments. Triggers on "review PR", "review this PR", "deep review", "PR review".
---

# PR Review — Deep Pull Request Inspection

Principal-engineer-grade inspection with a **multi-stage pipeline**: Triage -> Specialized Passes -> Filter -> Line-Level Output.

**Read-only.** Does NOT modify code, push commits, or resolve threads.

**Input**: PR number or URL (e.g., `5` or `https://github.com/lintyai/linty/pull/5`)

---

# STAGE 1: TRIAGE

## Phase 1: PR Setup

### 1.1 Auth & Metadata
```bash
gh auth status
gh pr view <NUMBER> --repo lintyai/linty --json number,title,headRefName,baseRefName,author,state,url,body,commits,additions,deletions,changedFiles,files
gh pr diff <NUMBER> --repo lintyai/linty --name-only
gh pr diff <NUMBER> --repo lintyai/linty
```

### 1.2 Checkout
```bash
gh pr checkout <NUMBER> --repo lintyai/linty
```

### 1.3 Check for Existing Inspection
```bash
gh api repos/lintyai/linty/pulls/{pr_number}/reviews --jq '
  .[] | select(.body | contains("PR Inspection Report")) | {id: .id, submitted_at: .submitted_at}
'
```

---

## Phase 2: Risk Classification

| Risk | Path Patterns | Depth |
|------|--------------|-------|
| **Critical** | `src-tauri/src/permissions.rs`, `src-tauri/src/fnkey.rs`, `Entitlements.plist`, `Info.plist`, `**/clipboard.*`, `**/paste.*` | Full + security pass |
| **High** | `src-tauri/src/*.rs`, `src/store/**`, `src/hooks/**`, `tauri.conf.json`, `Cargo.toml` | Deep line-by-line |
| **Medium** | `src/pages/**`, `src/components/**`, `src/services/**` | Standard |
| **Low** | `*.md`, `package.json`, `*.config.*`, `src/lib/**` | Light |

PR risk = **highest risk** among all changed files.

---

## Phase 3: PR Type Classification

| Type | Signals | Strategy |
|------|---------|----------|
| **Feature** | New files, new commands, new UI | Completeness Walk |
| **Bugfix** | "fix", targeted change | Root Cause Validation |
| **Refactor** | Same behavior, restructured | Equivalence Check |
| **Config** | Cargo.toml, tauri.conf.json, entitlements | Side-Effect Scan |

---

## Phase 4: Load Context

- **Always read**: `CLAUDE.md` (project conventions)
- **If Rust changed**: Read affected `.rs` files + `lib.rs` command registration
- **If frontend changed**: Read affected components, hooks, store slices
- **If config changed**: Read `tauri.conf.json`, `Cargo.toml`, `Entitlements.plist`

---

# STAGE 2: SPECIALIZED REVIEW PASSES

## Phase 5: Pass A — Bug, Logic & Performance

| Check | Severity |
|-------|----------|
| `.unwrap()` in production Rust code | Major |
| Mutex held across `.await` | Major |
| Missing error handling on Tauri commands | Major |
| Null/undefined access without checks (TS) | Major |
| Missing `useEffect` cleanup | Major |
| Dead code paths | Minor |
| Missing `.lean()` equivalent patterns | Minor |

---

## Phase 6: Pass B — Pattern & Convention

### Code Quality

| Check | Severity |
|-------|----------|
| `console.log` in production | Major |
| `any` type usage | Major |
| Unused imports/variables | Major |
| Hardcoded secrets | Major |
| `// @ts-ignore` without explanation | Major |

### Linty Conventions

| Check | Severity |
|-------|----------|
| File naming mismatch | Minor |
| Import order wrong | Minor |
| ID fields without entity prefix | Minor |
| Business logic in components (should be hooks/services) | Major |

### Rust Conventions

| Check | Severity |
|-------|----------|
| `.unwrap()` instead of `?` or proper error handling | Major |
| Unnecessary `.clone()` | Minor |
| `unsafe` without documentation | Major |
| FFI null pointer handling missing | Major |
| Tauri command not returning `Result` | Major |

---

## Phase 7: Pass C — Security & macOS

**Run on**: Critical/High risk files only.

| Check | Severity |
|-------|----------|
| Wrong entitlement key (must be `device.audio-input`) | Major |
| `LSUIElement` in Info.plist | Major |
| Hardcoded API keys or tokens | Major |
| Clipboard data not restored after paste | Major |
| CGEvent simulation without accessibility permission check | Major |
| Audio buffer exposed over IPC | Major |

---

## Phase 8: Pass D — Type-Specific Inspection

### Completeness Walk (Feature PRs)
- Tauri command registered in `lib.rs`?
- Frontend hook calls `invoke()` correctly?
- Error and loading states handled?
- Store slice updated?

### Root Cause Validation (Bugfix PRs)
- Fix addresses root cause, not symptom?
- Similar code elsewhere needs same fix?

### Equivalence Check (Refactor PRs)
- All exports preserved?
- Behavior unchanged?

### Side-Effect Scan (Config PRs)
- Entitlements still correct?
- Cargo features still work?
- Build still produces valid DMG?

---

# STAGE 3: FILTER

## Phase 9: Confidence Filtering

| Confidence | Criteria | Action |
|------------|----------|--------|
| **High** (90%+) | Deterministic (unused import, `console.log`, `.unwrap()`) | Always include |
| **Medium** (60-90%) | Pattern-based (convention violation, plausible failure) | Include with evidence |
| **Low** (<60%) | Speculative | **Exclude** |

---

# STAGE 4: OUTPUT

## Phase 10: Post Review on GitHub

```bash
cat > /tmp/pr-review-payload.json <<'PAYLOAD_EOF'
{
  "event": "<APPROVE|REQUEST_CHANGES|COMMENT>",
  "body": "<review body>",
  "comments": [
    {
      "path": "path/to/file",
      "line": 42,
      "side": "RIGHT",
      "body": "**[MAJOR]** Description\n\n**Why**: Evidence"
    }
  ]
}
PAYLOAD_EOF

gh api repos/lintyai/linty/pulls/{pr_number}/reviews \
  -X POST \
  --input /tmp/pr-review-payload.json

rm /tmp/pr-review-payload.json
```

### Review Body Template

```markdown
## PR Inspection Report

**PR Type**: <Type> | **Risk**: <Level> | **Intent**: <One sentence>

### Pipeline
| Pass | Findings |
|------|----------|
| A: Bug & Logic | X |
| B: Pattern & Convention | Y |
| C: Security & macOS | Z (or "Skipped") |
| D: <Strategy> | W |

### Summary
| Major | Minor |
|-------|-------|
| X | Y |

### What Looks Good
- <positive 1>
- <positive 2>
```

### Verdict
- 0 Major -> **APPROVE**
- 1+ Major -> **REQUEST_CHANGES**
- Only ambiguous -> **COMMENT**

---

## Phase 11: Build Validation

```bash
yarn build
cd src-tauri && cargo check --features local-stt
```

---

## Chain: Auto-invoke next step

After posting the review, automatically chain into the next skill based on the verdict:

| Verdict | Chain to | Reason |
|---------|----------|--------|
| REQUEST_CHANGES | `/pr-resolve` | Fix findings, then re-review |
| COMMENT (with findings) | `/pr-resolve` | Address comments before merge |
| APPROVE (0 findings) | `/pr-merge` | No issues — proceed to merge |
| COMMENT (0 findings, own PR) | `/pr-merge` | Can't self-approve, but clean — proceed to merge |

---

## Console Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PR INSPECTION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR:     <url>
Branch: <name>
Type:   <type> | Risk: <level>

FINDINGS:
  MAJOR:  N
  MINOR:  N

BUILD: PASS | FAIL
VERDICT: APPROVE | REQUEST_CHANGES | COMMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /pr-review
File:  .claude/skills/pr-review/SKILL.md
```

---

## Guidelines

- Read full files, not just hunks
- Understand intent before critiquing
- Cite evidence for every finding
- Include positive feedback
- Do NOT modify code — this is read-only
