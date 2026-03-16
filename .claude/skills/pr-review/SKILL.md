---
name: pr-review
user-invocable: true
disable-model-invocation: false
description: Deep PR review from a principal engineer's perspective. Multi-stage pipeline (Triage -> Specialized Passes -> Filter -> Output) with risk classification, security pass, cross-package impact analysis, and line-level GitHub comments. Triggers on "review PR", "review this PR", "review PR changes", "deep review", "PR review".
---

# PR Review — Deep Pull Request Inspection

Principal-engineer-grade inspection built on a **multi-stage pipeline** (inspired by Uber's uReview and Google's Tricorder). Classifies PR type and risk, runs specialized passes, filters noise, posts line-level findings on GitHub.

```
PR -> Triage -> Specialized Passes -> Filter & Dedupe -> Line-Level Output
```

**Read-only.** Does NOT modify code, push commits, or resolve threads.

**Input**: PR number or URL (e.g., `123` or `https://github.com/shekhardtu/colbin/pull/123`)

---

# STAGE 1: TRIAGE

## Phase 1: PR Setup

### 1.1 Auth & Metadata
```bash
gh auth status
gh pr view <NUMBER> --repo shekhardtu/colbin --json number,title,headRefName,baseRefName,author,reviewRequests,labels,state,url,body,commits,additions,deletions,changedFiles,files
gh pr diff <NUMBER> --repo shekhardtu/colbin --name-only
gh pr diff <NUMBER> --repo shekhardtu/colbin
gh pr view <NUMBER> --repo shekhardtu/colbin --json comments,commits
```

### 1.2 Checkout & Context
```bash
gh pr checkout <NUMBER> --repo shekhardtu/colbin
```

**Colbin Knowledge Docs**: Scan PR body for `colbin.com/bin/...` URLs. Fetch via `colbin_get_document` MCP for task context.

**GitHub Issues**: If PR body references `#<issue>` or `closes #<issue>`:
```bash
gh issue view <number> --repo shekhardtu/colbin --json title,body,labels
```

### 1.3 Check for Existing Inspection
```bash
gh api repos/shekhardtu/colbin/pulls/{pr_number}/reviews --jq '
  .[] | select(.body | contains("PR Inspection Report")) | {id: .id, submitted_at: .submitted_at}
'
```
- Previous inspection exists + no new commits -> skip
- New commits since last inspection -> proceed fresh

---

## Phase 2: Risk Classification

### 2.1 Risk Tiers

| Risk | Path Patterns | Depth |
|------|--------------|-------|
| **Critical** | `features/auth/**`, `features/permission/**`, `features/deviceAuth/**`, `features/securityAudit/**`, `middlewares/**`, `websocket/**`, `**/middleware*`, `**/*.guard.ts`, `**/*secret*`, `**/*token*`, `**/*credential*`, `**/*oauth*`, `config/**`, `.env*` | Full + security pass |
| **High** | `features/**/*.service.ts`, `features/**/*.controller.ts`, `features/**/*.model.ts`, `features/mcp/**`, `store/**`, `**/*.store.ts`, `routes/**`, `providers/**`, `packages/block-editor/src/collaboration/**`, `packages/websocket/**`, `packages/shared-types/**` | Deep line-by-line |
| **Medium** | `**/*.page.tsx`, `**/*.component.tsx`, `**/*.dialogue.tsx`, `**/*.hook.ts`, `hooks/**`, `utils/**`, `services/**`, `packages/block-editor/src/core/**`, `packages/magic-input/**` | Standard |
| **Low** | `**/*.test.*`, `**/*.md`, `**/package.json`, `**/*.config.*`, `**/public/**`, `**/assets/**` | Light |

### 2.2 Aggregate Risk
PR risk = **highest risk** among all changed files. Determines:
- Security Pass runs (Critical/High only)
- Cross-impact analysis runs (Critical/High + `packages/` changes)
- Verdict threshold (Critical PRs need zero Major findings)

---

## Phase 3: PR Type Classification

| Type | Signals | Strategy |
|------|---------|----------|
| **Cleanup / Removal** | "remove", "delete", net-negative lines, file deletions | **Reference Sweep** |
| **Feature** | "add", "implement", new files/routes/components | **Completeness Walk** |
| **Bugfix** | "fix", "resolve", small targeted change | **Root Cause Validation** |
| **Refactor** | "refactor", "restructure", "migrate", same behavior | **Equivalence Check** |
| **Config / Infra** | env vars, build config, Docker, deps | **Side-Effect Scan** |
| **UI / Design** | component changes, styling, layout | **Visual Consistency** |

A PR can have **multiple types**. Apply all relevant strategies.

Record: primary type, secondary types, one-sentence intent, scope boundary.

---

## Phase 4: Load Codebase Context

### 4.1 Read Instructions
- **Always**: Root `CLAUDE.md`
- **If API changed**: `apps/api/CLAUDE.md`
- **If editor changed**: `apps/editor/CLAUDE.md` (if exists)
- **If packages changed**: Relevant `packages/*/CLAUDE.md`

### 4.2 Read Code-Optimizer Patterns
```
Read: .claude/skills/code-optimizer/SKILL.md
```
Extract known anti-patterns for the team.

### 4.3 Neighborhood Reading (scales with risk)
- **Critical/High**: Full file + imports + importers (dependency graph)
- **Medium**: Full file + direct imports
- **Low**: File itself only

### 4.4 Engineering Principles
DRY (3+ duplications), KISS (over-engineering), YAGNI (speculative code), SRP (500+ line files), Performance (N+1, missing `.lean()`, `await` in loops), Separation of Concerns (business logic in controllers), Fail Fast (empty catch blocks).

---

# STAGE 2: SPECIALIZED REVIEW PASSES

## Phase 5: Pass A — Bug, Logic & Performance

**Run on**: All changed files.

| Check | Severity |
|-------|----------|
| Null/undefined access without checks | Major |
| Missing error handling (API calls without try/catch) | Major |
| Race conditions (state updates after unmount, stale closures) | Major |
| Infinite loops/renders (useEffect dep issues) | Major |
| Off-by-one errors | Major |
| Incomplete cleanup (useEffect without cleanup) | Major |
| Dead code paths | Minor |
| N+1 Mongoose query patterns | Major |
| Unbounded queries (missing `.limit()`) | Major |
| `await` in loops (use `Promise.all`) | Major |
| Missing pagination on list endpoints | Major |
| Y.js full sync when incremental suffices | Major |
| Buffer as JSON array instead of base64 | Major |
| Missing `.lean()` on read-only queries | Minor |
| Redis cache without invalidation on writes | Minor |

---

## Phase 6: Pass B — Pattern & Convention

**Run on**: All changed files.

### Code Quality

| Check | Severity |
|-------|----------|
| `console.log` in production code | Major |
| New `any` type usage | Major |
| Unused imports/variables | Major |
| Hardcoded secrets | Major |
| `dangerouslySetInnerHTML` without sanitization | Major |
| Missing `.js` extension in ES module imports (API) | Major |
| Commented-out code | Minor |
| TODO/FIXME without issue reference | Minor |

### Conventions (from CLAUDE.md)

| Check | Severity |
|-------|----------|
| File naming mismatch (`.component.tsx`, `.dialogue.tsx`, `.store.ts`, etc.) | Minor |
| Import order wrong (external -> `@colbin/*` -> relative) | Minor |
| ID fields without collection prefix (`id` instead of `userId`) | Minor |
| Business logic in controllers (should be services) | Major |
| Document queries missing `appSource: "editor"` | Major |
| Mongoose model names not snake_case | Minor |
| Custom UI when shadcn/ui component exists | Minor |

### Cross-Package Impact (only when `packages/` changed)

| Check | Severity |
|-------|----------|
| Changed exports break downstream imports | Major |
| Removed/renamed exports without consumer updates | Major |
| Type signature changes without downstream fixes | Major |

```bash
grep -r "from '@colbin/<package>'" apps/ packages/ --include='*.ts' --include='*.tsx' -l
```

---

## Phase 7: Pass C — Security

**Run on**: Critical/High risk files only. Skip for Medium/Low risk PRs.

| Check | Severity |
|-------|----------|
| Hardcoded secrets, tokens, connection strings | Major |
| Sensitive data in logs (PII, tokens) | Major |
| NoSQL injection (unsanitized input in Mongoose) | Major |
| XSS (unescaped user content in DOM) | Major |
| Routes/actions without auth checks | Major |
| Authorization gaps (missing role/permission checks) | Major |
| CORS misconfiguration | Major |
| New deps with known CVEs | Major |
| JWT handling issues (insecure storage, missing refresh) | Major |
| MCP OAuth callback URL bypass | Major |
| WebSocket endpoints without auth | Major |
| Hocuspocus direct connections without `sessionUserId` | Major |
| MCP tools without `requireScope()` checks | Major |
| MCP tools accessing documents without `requireDocumentAccess()` | Major |

---

## Phase 8: Pass D — Type-Specific Deep Inspection

Apply strategy from Phase 3 classification.

### 8.1 Reference Sweep (Cleanup PRs)
Build removal manifest (deleted files, removed exports/types/functions). Search **entire codebase** for leftover references:
- Unused imports from removed code -> Major
- Dead variables from removed imports -> Major
- Orphaned types only used by removed code -> Major
- Stale tests for removed functionality -> Major
- Stale comments/config referencing removed features -> Minor

### 8.2 Completeness Walk (Feature PRs)
Walk execution tree: Route -> Page -> Components -> Hooks -> API Calls -> Error Handlers.

| Missing | Severity |
|---------|----------|
| Error handling, loading states, types, permissions | Major |
| Empty states, edge cases, accessibility | Minor |

PM check: Does implementation match Colbin knowledge doc requirements? All acceptance criteria satisfied?

### 8.3 Root Cause Validation (Bugfix PRs)

| Check | Severity |
|-------|----------|
| Fix addresses root cause, not symptom | Major |
| Fix could break existing behavior | Major |
| Fix handles all variants of the bug | Major |
| Missing regression test | Minor |
| Similar code elsewhere needs same fix | Minor |

### 8.4 Equivalence Check (Refactor PRs)
All public exports preserved? Type signatures preserved? Same behavior? All consumers updated? Side effects preserved? -> Major for each failure.

### 8.5 Side-Effect Scan (Config PRs)
Build/runtime impact? Environment parity? Dependency conflicts? Docker/Railway impact? Yarn hoisting issues? -> Major for each.

### 8.6 Visual Consistency (UI PRs)
Uses shadcn/ui? Tailwind (no inline styles)? Loading/error states? Accessibility? -> Major for design system violations, Minor for style consistency.

### 8.7 Mongoose Patterns (when `*.model.ts` or `*.service.ts` changed)
Missing indexes for queries (Major), `appSource` filter missing (Major), wrong collection names in raw queries (Major), Buffer not base64 for Redis/HTTP (Major), missing timestamps (Minor), `$match` not early in aggregation (Minor).

---

# STAGE 3: FILTER & DEDUPLICATE

## Phase 9: Confidence Filtering

### 9.1 Confidence Levels

| Confidence | Criteria | Action |
|------------|----------|--------|
| **High** (90%+) | Deterministic (unused import, `console.log`, `any` type, clear crash path) | Always include |
| **Medium** (60-90%) | Pattern-based (convention violation, plausible failure) | Include with evidence |
| **Low** (<60%) | Speculative (might be intentional, subjective) | **Exclude** |

### 9.2 Filtering Rules
Exclude: auto-generated files, duplicates (keep most specific), style preferences without CLAUDE.md rule.
Include: pre-existing issues in changed files if they are security, correctness, or type-safety concerns — a PR review is a quality gate for the codebase, not just the diff.

### 9.3 Deduplication
Same pattern in N files -> consolidate into one finding with file list. Post inline on most representative instance.

### 9.4 Risk-Based Threshold

| PR Risk | Min Confidence |
|---------|---------------|
| Critical/High | Medium (60%) |
| Medium/Low | High (90%) |

---

# STAGE 4: OUTPUT

## Phase 10: Post Line-Level Review on GitHub

### 10.1 Determine Diff Positions

For each finding:
1. Parse `gh pr diff` output for `@@` hunk ranges
2. If line is **in diff** (RIGHT side) -> add to `comments[]` with `path`, `line`, `side: "RIGHT"`
3. If line is **outside diff** -> move to "Findings Outside Diff" in review body

### 10.2 Post the Review

```bash
cat > /tmp/pr-review-payload.json <<'PAYLOAD_EOF'
{
  "event": "<APPROVE|REQUEST_CHANGES|COMMENT>",
  "body": "<review body>",
  "comments": [
    {
      "path": "path/to/file.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "**[MAJOR]** Description...\n\n**Why**: Evidence...\n\n<details>\n<summary>Suggestion</summary>\n\n```suggestion\n// corrected code\n```\n\n</details>"
    }
  ]
}
PAYLOAD_EOF

gh api repos/shekhardtu/colbin/pulls/{pr_number}/reviews \
  -X POST \
  --input /tmp/pr-review-payload.json

rm /tmp/pr-review-payload.json
```

**Fallback**: If `gh api` fails, retry once, then fall back to `gh pr review --comment --body`.

### 10.3 Inline Comment Format

```markdown
**[SEVERITY]** Brief description

**Why**: Explanation with evidence.

<details>
<summary>Suggestion</summary>

\`\`\`suggestion
// corrected code — GitHub renders as one-click fix
\`\`\`

</details>
```

For findings without code suggestion, use `**Action**: What to do.` instead of details block.

### 10.4 Review Body Template

```markdown
## PR Inspection Report

**PR Type**: <Type> | **Risk**: <Level> | **Intent**: <One sentence>
**Colbin Doc**: <title + URL, if found>

### Pipeline

| Pass | Findings |
|------|----------|
| A: Bug & Logic + Perf | X |
| B: Pattern & Convention | Y |
| C: Security | Z (or "Skipped") |
| D: <Strategy> | W |
| Filtered out | N |

### Summary
| Major | Minor | Trivial |
|-------|-------|---------|
| X | Y | Z |

### Cross-Package Impact
<if applicable>

### Findings Outside Diff
<if any>

### What Looks Good
- <positive 1>
- <positive 2>

---
*Reviewed by [`/pr-review`](https://github.com/shekhardtu/colbin/blob/main/.claude/skills/pr-review/SKILL.md)*
```

---

## Phase 11: Build Validation

```bash
yarn typecheck
# Or workspace-specific:
yarn workspace @colbin/api build    # if API changed
yarn workspace @colbin/web build    # if Web changed
```

Report: PASS (clean or pre-existing only) or FAIL (new errors, list them).

---

## Phase 12: Console Output

```
════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 PR INSPECTION REPORT
════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 PR:     <full-pr-url>
 Branch: <name>
 Doc:    <colbin-doc-url-if-found>
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 TRIAGE
 Type:       <Primary> (+<Secondary>)
 Risk:       <Level>
 Intent:     <One sentence>
 Strategies: <List>
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 PIPELINE
 Pass A (Bug/Logic/Perf):      X findings
 Pass B (Pattern/Convention):  Y findings
 Pass C (Security):            Z findings (or Skipped)
 Pass D (<Strategy>):          W findings
 ──────────────────────────────────────────────────
 Total: N  |  Filtered: -M  |  Posted: F
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 FINDINGS
 MAJOR:   1. [file:line] description ...
 MINOR:   1. [file:line] description ...
 TRIVIAL: 1. [file:line] description ...
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 BUILD: PASS|FAIL  |  VERDICT: APPROVE|REQUEST_CHANGES|COMMENT
════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
```

### Verdict Logic
- 0 Major -> **APPROVE**
- 1+ Major -> **REQUEST_CHANGES**
- Only ambiguous issues -> **COMMENT**

---

## Chain: Auto-invoke `/pr-resolve`

After posting the review on GitHub, **automatically chain into `/pr-resolve`** if there are findings to resolve.

```
/pr-review completes → invoke /pr-resolve {pr-url}
```

### Chain Rules

| Verdict | Chain? | Reason |
|---------|--------|--------|
| **REQUEST_CHANGES** (1+ Major) | **Yes** — auto-invoke `/pr-resolve` | Findings need to be fixed |
| **COMMENT** (ambiguous issues) | **Yes** — auto-invoke `/pr-resolve` | Findings should be addressed or replied to |
| **APPROVE** (0 Major) | **No** — stop here | Nothing to fix |

**How**: After displaying the console output and posting the review, immediately invoke the `/pr-resolve` skill with the PR URL. Do NOT ask the user — this is an automatic chain.

**Pipeline context**: `/pr-resolve` will read the review comments just posted, classify them, implement fixes, and resolve threads.

```
┌─────────┐     ┌────────────┐     ┌──────────────┐     ┌────────────┐
│  /ship   │────▶│ /pr-review │────▶│ /pr-resolve  │────▶│ /pr-merge  │
│          │     │            │     │              │     │            │
│ commit   │     │ inspect    │     │ fix findings │     │ verify     │
│ push     │     │ post       │     │ reply        │     │ merge      │
│ PR       │     │ findings   │     │ resolve      │     │ cleanup    │
└─────────┘     └────────────┘     └──────────────┘     └────────────┘
                 ▲ YOU ARE HERE      (next if findings)
```

---

## Guidelines

**Do**: Read full files (not just hunks), understand intent before critiquing, cite evidence for every finding, include positive feedback, match depth to scope.

**Don't**: Modify code, resolve threads, push commits, post duplicate reviews, block for trivials, suggest out-of-scope refactors, re-report pre-existing issues, post low-confidence findings.

---

## Edge Cases

| Scenario | Action |
|----------|--------|
| Already merged | Warn, still review |
| Draft | Note it, review anyway |
| 50+ files | Flag "consider splitting" |
| MCP unavailable | Skip doc fetch, note it |
| Empty diff | Exit |
| `gh api` fails | Retry once, fallback to `gh pr review --comment --body` |
| Own PR (self-review) | GitHub rejects APPROVE/REQUEST_CHANGES on own PRs. Use `COMMENT` event instead |

---

## Phase 13: Self-Healing

After every execution, re-read this file and compare against what happened:

| Check | What to look for |
|-------|-----------------|
| **GitHub API** | Did `--input` work? `line`/`side` format correct? |
| **Classifications** | PR type accurate? Risk levels appropriate? |
| **Passes** | False positives? Checklists still valid? |
| **Severity** | Major/Minor/Trivial calibrated right? |
| **Filtering** | Low-quality posted? High-quality filtered? |
| **Build** | `yarn typecheck` worked? |

Fix inaccuracies with `Edit` tool. Log changes:
```
Self-Healing Log:
- Fixed: <what> -> <what>
- Reason: <why>
```

Check for new file paths not in risk classification:
```bash
gh pr view <number> --repo shekhardtu/colbin --json files --jq '.files[].path' | xargs -I{} dirname {} | sort -u
```
