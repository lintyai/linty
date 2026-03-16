---
name: backlog
user-invocable: true
disable-model-invocation: false
description: Capture feature ideas, tech debt, and bugs into a GitHub Issue backlog. Each entry includes codebase context for easy handoff to /build. Triggers on "backlog", "add to backlog", "track this", "backlog mark".
---

# Backlog Register

Lightweight skill to capture ideas into **GitHub Issues** with structured labels. Each entry has enough codebase context that someone can copy-paste it into `/build` and start implementing.

---

## Triggers

- `/backlog <description>` — Add a new backlog entry
- `/backlog mark #NNN <status>` — Update an issue's status (close, label change)
- Casual inline: `Implement noise cancellation /backlog` (description before the command)

---

## Phase 1: PARSE

Extract from the user's prompt:

| Field | How to determine |
|-------|-----------------|
| **Title** | Short imperative title from the description (e.g., "Add noise cancellation filter") |
| **Type** | `feature` (new capability), `tech-debt` (refactor/cleanup), `bug` (broken behavior). Default: `feature` |
| **Priority** | `P1` (critical), `P2` (important), `P3` (normal), `P4` (nice-to-have). Default: `P3` |

If the prompt is a **status update** (contains `mark #NNN`), skip to Phase 4b instead.

---

## Phase 2: RESEARCH

Quick codebase scan — 3-5 tool calls max. Do NOT over-research; this is a backlog capture, not a full `/build` investigation.

### 2.1 Find Related Files

```
Grep for keywords from the title/description across the project.
Glob for likely file patterns (components, hooks, Rust modules).
```

### 2.2 Check for Existing Work

```
Grep for TODOs, FIXMEs, or existing partial implementations related to this idea.
```

### 2.3 Identify Affected Areas

Determine which areas are affected:
- `src/` — React frontend (pages, components, hooks, store, services)
- `src-tauri/src/` — Rust backend (audio, transcription, macOS FFI, IPC)
- `src-tauri/` — Tauri config, Cargo deps, entitlements

### 2.4 Estimate Complexity

| Size | Criteria |
|------|----------|
| XS | 1 file, minor change |
| S | 1-2 files, follows existing pattern |
| M | 2-4 files, new component but known patterns |
| L | 4-8 files, new pattern or cross-cutting |
| XL | 8+ files, architectural change |

---

## Phase 3: ANALYZE

From research, compile:

- **Key files**: Up to 5-8 most relevant files with path, purpose, and action (Create/Modify)
- **Blast radius**: Which systems/layers are touched (frontend, Rust backend, macOS FFI, Tauri config)
- **Risks**: 1-3 bullets on what could go wrong or get complicated
- **Implementation hints**: 2-4 bullets with enough context for `/build` to start (existing patterns to follow, APIs to use, components to extend)
- **Related code**: Existing TODOs, partial implementations, related features

---

## Phase 4a: DOCUMENT (New Entry)

### 4.1 Create GitHub Issue

```bash
gh issue create --repo lintyai/linty \
  --title "[BACKLOG] <Title>" \
  --label "backlog,<type>,<priority>" \
  --body "$(cat <<'EOF'
## Description
<Expanded description — 2-4 sentences with enough context to understand the ask>

**Type**: <feature/tech-debt/bug> | **Priority**: <P1-P4> | **Complexity**: <XS-XL>

## Affected Areas
- `src/` — <what in frontend>
- `src-tauri/src/` — <what in Rust backend>

## Key Files
| File | Purpose | Action |
|------|---------|--------|
| `path/to/file` | What this file does | Create/Modify |

## Blast Radius
<1-2 sentences on what systems/layers are touched>

## Risks
- <Risk 1>
- <Risk 2>

## Related Code
- <Existing pattern, TODO, or dependency worth noting>

## Implementation Hints
- <Hint 1: enough for /build to start>
- <Hint 2>
EOF
)"
```

Ensure labels exist first. If they don't:
```bash
gh label create "backlog" --repo lintyai/linty --color "0E8A16" 2>/dev/null || true
gh label create "feature" --repo lintyai/linty --color "1D76DB" 2>/dev/null || true
gh label create "tech-debt" --repo lintyai/linty --color "FBCA04" 2>/dev/null || true
gh label create "bug" --repo lintyai/linty --color "D73A4A" 2>/dev/null || true
gh label create "P1" --repo lintyai/linty --color "B60205" 2>/dev/null || true
gh label create "P2" --repo lintyai/linty --color "D93F0B" 2>/dev/null || true
gh label create "P3" --repo lintyai/linty --color "E4E669" 2>/dev/null || true
gh label create "P4" --repo lintyai/linty --color "C2E0C6" 2>/dev/null || true
```

---

## Phase 4b: STATUS UPDATE

When the prompt contains `mark #NNN <status>`:

1. Fetch the issue: `gh issue view NNN --repo lintyai/linty`
2. Update based on status:
   - `done` → `gh issue close NNN --repo lintyai/linty`
   - `in-progress` → `gh issue edit NNN --repo lintyai/linty --add-label "in-progress"`
   - `cancelled` → `gh issue close NNN --repo lintyai/linty --reason "not planned"`
   - `open` → `gh issue reopen NNN --repo lintyai/linty`
3. Display confirmation

---

## Phase 5: OUTPUT

### New Entry Confirmation

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  BACKLOG ENTRY ADDED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Issue:      #NNN
Title:      <Title>
Type:       <feature/tech-debt/bug>
Priority:   <P1-P4>
Complexity: <XS-XL>
Files:      <N> key files identified

URL: <github-issue-url>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tip: Run `/build <Title>` to start implementing this entry.

Skill: /backlog
File:  .claude/skills/backlog/SKILL.md
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| `gh` CLI fails | Retry once, then inform user |
| Issue already exists with same title | Warn user, still create (different IDs) |
| Label doesn't exist | Create it automatically |

---

## Tips

- Keep entries concise — this is a backlog, not a design doc
- If research reveals the idea is trivial (XS), suggest just doing it now instead of backlogging
- If research reveals the idea is massive (XL+), suggest breaking it into multiple entries
