---
name: build
user-invocable: true
disable-model-invocation: false
description: End-to-end development workflow. Researches codebase, gets human approval, plans with sub-tasks, implements with documentation, and optionally chains into /ship. Triggers on "build this", "develop this", "implement this", "start building".
---

# Build Workflow

End-to-end development lifecycle: Research -> Human Approval -> Plan -> Implement -> Document -> (optional) Ship.

## When to Use

Run `/build` when you have a new task to implement:
- New feature development
- Bug investigation and fix
- Refactoring work
- Significant architectural changes
- Any task that benefits from upfront research and documentation

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
- Feature (`feat`)
- Bug Fix (`fix`)
- Refactor (`refactor`)
- Documentation (`docs`)
- Chore (`chore`)

### Parse the Task

From the user's prompt, identify:
- **What**: The feature/fix/change requested
- **Why**: The business reason or user problem
- **Scope**: Which layer(s) affected (frontend React, Rust backend, Tauri config, macOS FFI)
- **URLs**: Any links provided (PRDs, design docs, external references)

---

## Phase 2: RESEARCH

Before implementation, autonomously gather comprehensive context.

### 2.1 Codebase Analysis

Use Grep, Glob, and Read tools to:

1. **Find related files**: Search for components, stores, hooks, Rust modules related to the task
2. **Identify existing patterns**: How similar features are implemented
3. **Check for reusable code**: Shared components, utilities, existing hooks
4. **Map dependencies**: What imports, stores, Tauri commands the affected area uses
5. **Scan for tech debt**: TODOs, FIXMEs, and known issues in affected areas

### 2.2 Git History

```bash
git log --oneline -10 -- <affected-paths>
```

### 2.3 External Context

If the user provided URLs (PRDs, docs, API specs):
- Fetch each URL using `WebFetch`
- Summarize the relevant content
- Extract acceptance criteria or design specs

### 2.4 Research Summary

Compile findings into a structured format:
- List of affected files with their purpose
- Existing patterns to follow
- Reusable components/utilities available
- Potential risks or edge cases discovered

---

## Phase 3: HUMAN VERIFICATION (Gate)

**This is a mandatory gate. Do not proceed without approval.**

Present to the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RESEARCH COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task:       <1-line summary>
Priority:   <priority>
Type:       <type>
Estimate:   <size XS-XL>

Summary:
<2-3 sentence summary of research findings>

Acceptance Criteria: <count> items
Implementation Steps: <count> items
Files Affected: <count> files

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use `AskUserQuestion`:
- **"Does this look correct? Should I proceed to planning?"**
  - Options: "Approve and proceed" / "I want to modify it" / "Cancel"

**Do not proceed to Phase 4 until explicitly approved.**

---

## Phase 4: PLANNING

### 4.1 Enter Plan Mode

Use `EnterPlanMode` to design the implementation strategy.

During plan mode:
1. Read all affected files identified in research
2. Understand the complete context
3. Design the step-by-step implementation approach
4. Identify what can be done in parallel vs sequentially

### 4.2 Task Breakdown

**For L-sized or larger tasks**, create sub-tasks using `TaskCreate`:

Sub-task ordering rules for Linty:
- Types/interfaces first (`src/types/`)
- Rust backend next (`src-tauri/src/` — state, commands, FFI)
- Then Tauri IPC wiring (commands registration in `lib.rs`)
- Then React frontend (hooks, components, pages)
- Then store updates (`src/store/slices/`)
- Config last (Tauri config, entitlements, Cargo features)

### 4.3 Exit Plan Mode

Present the plan via `ExitPlanMode` for user approval.

---

## Phase 5: IMPLEMENTATION

Execute the approved plan. For each sub-task:

### 5.1 Start Task

Mark task as in_progress using `TaskUpdate`

### 5.2 Implement Code

Write the code following all codebase conventions from CLAUDE.md.

Follow the project's file naming conventions:
- Components: `ComponentName.component.tsx`
- Pages: `PageName.page.tsx`
- Stores: `name.store.ts`
- Slices: `name.slice.ts`
- Services: `name.service.ts`
- Hooks: `useName.hook.ts`
- Types: `name.types.ts`
- Dialogues: `DialogName.dialogue.tsx`

### 5.3 Complete Task

Mark task as completed using `TaskUpdate`, move to next.

### 5.4 Discovery Log

If during implementation you discover:
- **New bugs**: Note them for the summary
- **Tech debt**: Note it
- **Scope creep**: Note it but do NOT implement it

---

## Phase 6: VERIFICATION

After all implementation is complete:

### 6.1 Build Check

```bash
# TypeScript check + Vite build
yarn build

# Rust check
cd src-tauri && cargo check --features local-stt && cd ..
```

### 6.2 Quality Check

- [ ] All acceptance criteria met
- [ ] Build passes (both frontend and Rust)
- [ ] No console.log statements in changed files
- [ ] No `any` types introduced
- [ ] Existing patterns followed

---

## Phase 7: HANDOFF

### 7.1 Ship Decision

Ask the user:
- **"Implementation is complete. Would you like to ship now?"**
  - Options: "Yes, run /ship" / "Not yet, I'll ship manually later"

If "Yes":
- Invoke the `/ship` skill to handle branch creation, commit, and PR

### 7.2 Final Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  BUILD COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
| User rejects research | Gather feedback, re-research |
| Research finds existing solution | Present finding, ask user how to proceed |
| Build fails during implementation | Fix the issue |
| User cancels mid-workflow | Summarize what was done |

---

## Tips

- Keep tasks focused — one logical feature per `/build` invocation
- If research reveals the task is much larger than expected, discuss with the user
- Always check existing components before creating new ones
- Follow existing patterns — consistency over cleverness
