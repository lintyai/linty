---
name: build
user-invocable: true
disable-model-invocation: false
description: End-to-end development workflow. Researches codebase, creates a Colbin knowledge document with full context, gets human approval, plans with sub-tasks, implements with documentation, and optionally chains into /ship. Triggers on "build this", "develop this", "implement this", "start building".
---

# Build Workflow

End-to-end development lifecycle: Research → Colbin Doc → Human Approval → Plan → Implement → Document → (optional) Ship.

## When to Use

Run `/build` when you have a new task to implement:
- New feature development
- Bug investigation and fix
- Refactoring work
- Significant architectural changes
- Any task that benefits from upfront research and documentation

**This skill handles everything BEFORE `/ship`**. At the end, it optionally chains into `/ship` for branch/commit/PR creation.

---

## Phase 1: INTAKE

Collect essential information before starting. Use `AskUserQuestion` to gather:

### Required Questions

**Question 1: Priority**
- Urgent (P1) — Blocking or critical
- High (P2) — Important, needed soon
- Normal (P3) — Standard work
- Low (P4) — Nice to have

**Question 2: Type**
Determine the type of work:
- Feature (`feat`)
- Bug Fix (`fix`)
- Refactor (`refactor`)
- Documentation (`docs`)
- Chore (`chore`)

### Parse the Task

From the user's prompt, identify:
- **What**: The feature/fix/change requested
- **Why**: The business reason or user problem
- **Scope**: Which app(s)/packages affected (api, web, block-editor, magic-input, shared-types)
- **URLs**: Any links provided (PRDs, Figma, API docs, external references)

---

## Phase 2: RESEARCH

Before creating the document, autonomously gather comprehensive context. **This is critical — the document must contain enough information for anyone to understand and implement the task.**

### 2.1 Codebase Analysis

```
Use Grep, Glob, and Read tools to:
```

1. **Find related files**: Search for components, stores, services, hooks related to the task
2. **Identify existing patterns**: How similar features are implemented in the codebase
3. **Check for reusable code**: Shared components, utilities, existing hooks
4. **Map dependencies**: What imports, contexts, stores the affected area uses
5. **Scan for tech debt**: TODOs, FIXMEs, and known issues in affected areas

### 2.2 Git History

```bash
# Recent changes in affected areas
git log --oneline -10 -- <affected-paths>

# Who last modified these files
git log --format='%an' -5 -- <affected-paths> | sort -u
```

### 2.3 External Context

If the user provided URLs (PRDs, Figma, docs, API specs):
- Fetch each URL using `WebFetch`
- Summarize the relevant content
- Extract acceptance criteria, design specs, or API contracts

### 2.4 Test Coverage

```
Check what tests exist for affected areas:
- Search for *.test.tsx, *.spec.tsx, *.test.ts files in affected directories
- Note what's covered and what's missing
```

### 2.5 Research Summary

Compile findings into a structured format for the document. Include:
- List of affected files with their purpose
- Existing patterns to follow
- Reusable components/utilities available
- Potential risks or edge cases discovered

---

## Phase 3: COLBIN DOCUMENT CREATION

Create a Colbin knowledge document using `colbin_create_document` with the research findings. This document serves as the **single source of truth** for the task — created BEFORE implementation begins.

### Document Fields

```
title: Clear, action-oriented title (e.g., "Feature: Real-time Presence Indicators" or "Fix: Document Sharing Permission Bug")
type: "document" (Markdown)
parentDocumentId: "69a4171aab146a731a14e6f8"
```

### Document Content Template

````markdown
# [Title]

> **Priority**: P[1-4] | **Type**: [feat/fix/refactor/docs/chore] | **Status**: Research Complete

## Context & Background
<Why this work is needed. Business justification from user's prompt and any PRD/docs fetched.>

## Problem Statement
<What specific problem are we solving? Who is affected? What's the current behavior vs desired?>

## Technical Research

### Affected Files & Areas
| File | Purpose | Action |
|------|---------|--------|
| `apps/web/src/pages/Example.page.tsx` | Main page component | Modify |
| `apps/api/src/features/example/example.service.ts` | Business logic | Modify |
| `apps/web/src/stores/example.store.ts` | State management | New |

### Existing Patterns Found
<How similar features are implemented. Specific file references with line numbers.>
- Pattern A: `apps/web/src/pages/Dashboard/...` uses Zustand + React Query
- API pattern: Express/TSOA controller → service → model
- UI: shadcn/ui components with Tailwind

### Reusable Components
<What exists in the codebase that should be reused>
- Component X from `apps/web/src/components/...`
- Hook Y from `apps/web/src/hooks/...`
- Utility Z from `packages/shared-types/...`

### Dependencies & Blockers
- Depends on: <list or "None">
- Blocks: <list or "None">
- Related work: <list or "None">

## Acceptance Criteria
- [ ] <Specific, testable criterion 1>
- [ ] <Specific, testable criterion 2>
- [ ] <Specific, testable criterion 3>
- [ ] Error states handled
- [ ] Loading states implemented

## Technical Approach
<High-level architecture decision and reasoning>
- **Approach**: <description>
- **Rationale**: <why this approach over alternatives>
- **Trade-offs**: <what we're accepting>

## Estimation
**Size**: <XS|S|M|L|XL|XXL>
**Basis**: <N> files affected, <new vs modify>, <testing complexity>

## Risks & Edge Cases
- <Risk 1: description + mitigation>
- <Edge case 1: description + handling approach>

## Implementation Checklist
- [ ] Step 1: <description>
- [ ] Step 2: <description>
- [ ] Step N: <description>
- [ ] Add tests
- [ ] Update documentation

## References
- <Link to PRD/design/API docs if provided>
- <Link to relevant codebase files>
````

### Estimation Framework

Auto-calculate estimation based on research findings:

| Size | Criteria |
|------|----------|
| XS | 1 file, minor change, no new patterns |
| S | 1-2 files, follows existing pattern exactly |
| M | 2-4 files, new component but known patterns |
| L | 4-8 files, new pattern or API integration |
| XL | 8+ files, architectural change, cross-cutting |
| XXL | System-wide impact, multiple sub-systems |

**IMPORTANT**: Store the document `url` and `slug` from the response — they're needed throughout the workflow.

---

## Phase 4: HUMAN VERIFICATION (Gate)

**This is a mandatory gate. Do not proceed without approval.**

Present to the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  COLBIN KNOWLEDGE DOC CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Document:  [Title](colbin-doc-url)
Priority:  <priority>
Type:      <type>
Estimate:  <size>

Summary:
<2-3 sentence summary of what the document covers>

Acceptance Criteria: <count> items
Implementation Steps: <count> items
Files Affected: <count> files

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use `AskUserQuestion` to ask:
- **"Does this look correct? Should I proceed to planning?"**
  - Options: "Approve and proceed" / "I want to modify it" / "Cancel"

If user wants modifications:
1. Gather their feedback
2. Update the Colbin document using `colbin_update_document_content`
3. Present again for approval

**Do not proceed to Phase 5 until explicitly approved.**

---

## Phase 5: PLANNING

### 5.1 Enter Plan Mode

Use `EnterPlanMode` to design the implementation strategy.

During plan mode:
1. Read all affected files identified in research
2. Understand the complete context
3. Design the step-by-step implementation approach
4. Identify what can be done in parallel vs sequentially

### 5.2 Task Breakdown

**For L-sized or larger tasks**, create sub-tasks using `TaskCreate`:

Sub-task ordering rules:
- Types/interfaces first (shared-types package)
- Data layer next (API: controllers, services, repositories)
- Then UI components (web: components, pages)
- Then integration/wiring (stores, hooks)
- Tests last (or alongside each step)

### 5.3 Update Colbin Document

After planning, update the document with the refined plan:

```
colbin_update_document_content with the refined implementation checklist,
sub-task breakdown, and any new findings from plan mode.
```

### 5.4 Exit Plan Mode

Present the plan via `ExitPlanMode` for user approval.

---

## Phase 6: IMPLEMENTATION

Execute the approved plan. For each sub-task (or each step if no sub-tasks):

### 6.1 Start Task

1. Mark task as in_progress using `TaskUpdate`
2. Update Colbin document status section: `**Status**: In Progress`

### 6.2 Implement Code

Write the code following all codebase conventions from CLAUDE.md.

Follow the project's file naming conventions:
- Components: `ComponentName.component.tsx`
- Pages: `PageName.page.tsx`
- Stores: `name.store.ts`
- Services: `name.service.ts`
- Hooks: `useName.hook.ts`
- Types: `name.types.ts`

### 6.3 Complete Task

1. Mark task as completed using `TaskUpdate`
2. Move to next task

### 6.4 Discovery Log

If during implementation you discover:
- **New bugs**: Note in the Colbin document under a "Discovered Issues" section
- **Tech debt**: Note in the Colbin document
- **Scope creep**: Note it but do NOT implement it

---

## Phase 7: DOCUMENTATION

After all implementation is complete:

### 7.1 Update Colbin Document

Update the document with implementation results using `colbin_update_document_content`:

Append or update these sections:

````markdown
## Implementation Summary

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `<path>` | Created | <purpose> |
| `<path>` | Modified | <what changed> |

### Architecture Decisions
- <Decision 1>: <chosen approach> because <reason>
- <Decision 2>: <chosen approach> because <reason>

### Testing
- <What was tested>
- <What needs manual testing>

### Deviations from Plan
- <Any changes from original plan, or "None">

### Known Limitations
- <Any known limitations or future work>

### Discovered Issues
- <Issue 1: description>
- Or "None discovered"

---
**Status**: Implementation Complete
````

### 7.2 Verify Quality

Run a quick check:
- `yarn workspace @colbin/api build` or `yarn workspace @colbin/web build` (depending on scope)
- Verify no TypeScript errors
- Verify no console.log statements in changed files

---

## Phase 8: HANDOFF

### 8.1 Quality Check

Before finishing, verify:
- [ ] All acceptance criteria from the document are met
- [ ] Build passes for affected workspaces
- [ ] No console.log statements in changed files
- [ ] Colbin document is updated with final state

### 8.2 Ship Decision

Ask the user:
- **"Implementation is complete. Would you like to ship now?"**
  - Options: "Yes, run /ship" / "Not yet, I'll ship manually later"

If "Yes":
- Invoke the `/ship` skill to handle branch creation, commit, and PR
- **IMPORTANT**: Include the Colbin document URL in the PR description under a `## Knowledge Doc` section:
  ```markdown
  ## Knowledge Doc
  - [Document Title](colbin-doc-url)
  ```

If "Not yet":
- Display summary of what was built

### 8.3 Final Summary

Display completion summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  BUILD COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Knowledge Doc:  [Title](colbin-doc-url)
Files Changed:  <count> (<count> new, <count> modified)
Estimation:     <size>
Status:         <current status>

Key Decisions:
- <decision 1>
- <decision 2>

Next Steps:
- <what the user should do next>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /build
File:  .claude/skills/build/SKILL.md
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Colbin MCP fails | Retry once, then inform user and continue without doc |
| User rejects document | Gather feedback, update doc, re-present |
| Research finds existing solution | Present finding, ask user how to proceed |
| Build/typecheck fails during implementation | Fix the issue, note it in document |
| User cancels mid-workflow | Summarize what was done, update document with partial status |

---

## State Tracking

Throughout the entire workflow, maintain awareness of:
- **Colbin document URL and slug**
- **Current phase** (which phase we're in)
- **Files changed** (running list of all modifications)
- **Decisions made** (running list for documentation)

Use `TaskCreate`/`TaskUpdate` to track all tasks and sub-tasks throughout the workflow.

---

## Tips

- Keep tasks focused — one logical feature per `/build` invocation
- If research reveals the task is much larger than expected, discuss with the user before creating the document
- Always check existing components before creating new ones
- Follow existing patterns in the codebase — consistency over cleverness
- The Colbin document is the single source of truth — keep it updated
- When in doubt about scope, ask the user rather than assuming

---

## Phase 9: SELF-HEALING

**After every `/build` execution**, run this phase to keep the skill accurate.

### 9.1 Evaluate Skill Accuracy

Re-read this skill file and compare its instructions against what actually happened during execution:

| Check | What to look for |
|-------|-----------------|
| **MCP tool names** | Did any `colbin_*` MCP calls fail because the tool name, parameter name, or syntax changed? |
| **CLI commands** | Did any `gh`, `git`, or `yarn` commands fail due to wrong flags or changed syntax? |
| **Workflow logic** | Did any phase need to be skipped, reordered, or modified? |
| **Templates** | Are document templates and examples still accurate? |
| **Tool availability** | Did any referenced tool behave differently than documented? |

### 9.2 Fix Issues Found

If any discrepancies were found:
1. Use the `Edit` tool to fix the specific inaccurate section in this skill file
2. Keep changes minimal and targeted — fix only what's wrong
3. Log each fix:

```
Self-Healing Log:
- Fixed: <what was wrong> → <what it was changed to>
- Reason: <why the original was inaccurate>
```

If nothing needs fixing, skip silently.

### 9.3 Append Attribution

For the **PR description** (if `/ship` was chained), ensure the Knowledge Doc section and skill attribution are present:

```markdown
## Knowledge Doc
- [Document Title](colbin-doc-url)

---
*Generated by `/build` skill*
```
