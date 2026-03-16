---
name: backlog
user-invocable: true
disable-model-invocation: false
description: Capture feature ideas, tech debt, and bugs into a single Colbin backlog document. Each entry includes codebase context for easy handoff to /build. Triggers on "backlog", "add to backlog", "track this", "backlog mark".
---

# Backlog Register

Lightweight skill to capture ideas into a **single living Colbin document**. Each entry has enough codebase context that someone can copy-paste it into `/build` and start implementing.

---

## Triggers

- `/backlog <description>` — Add a new backlog entry
- `/backlog mark BL-NNN <status>` — Update an entry's status (e.g., `done`, `in-progress`, `cancelled`)
- Casual inline: `Implement image upload /backlog` (description before the command)

---

## Phase 1: PARSE

Extract from the user's prompt:

| Field | How to determine |
|-------|-----------------|
| **Title** | Short imperative title from the description (e.g., "Implement image upload") |
| **Type** | `feature` (new capability), `tech-debt` (refactor/cleanup), `bug` (broken behavior). Default: `feature` |
| **Priority** | `P1` (critical), `P2` (important), `P3` (normal), `P4` (nice-to-have). Default: `P3` |

If the prompt is a **status update** (contains `mark BL-NNN`), skip to Phase 4b instead.

---

## Phase 2: RESEARCH

Quick codebase scan — 3-5 tool calls max. Do NOT over-research; this is a backlog capture, not a full `/build` investigation.

### 2.1 Find Related Files

```
Grep for keywords from the title/description across the monorepo.
Glob for likely file patterns (components, services, stores).
```

### 2.2 Check for Existing Work

```
Grep for TODOs, FIXMEs, or existing partial implementations related to this idea.
```

### 2.3 Identify Affected Workspaces

Determine which workspaces are affected:
- `apps/api` — Backend
- `apps/editor` — Frontend
- `packages/block-editor` — Editor core
- `packages/magic-input` — Input transformations
- `packages/shared-types` — Shared types
- `packages/hagen-client` — API client

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
- **Blast radius**: Which systems/layers are touched
- **Risks**: 1-3 bullets on what could go wrong or get complicated
- **Implementation hints**: 2-4 bullets with enough context for `/build` to start (existing patterns to follow, APIs to use, components to extend)
- **Related code**: Existing TODOs, partial implementations, related features

---

## Phase 4a: DOCUMENT (New Entry)

### 4.1 Get or Create the Backlog Document

**First, check MEMORY.md** for a stored backlog document slug (under "Key Colbin Documents").

- **If slug exists**: Read the document using `colbin_get_document` with that slug
- **If slug doesn't exist or document not found**: Create a new document:

```
colbin_create_document:
  title: "Colbin Product Backlog"
  type: "document"
  parentDocumentId: "69a4171aab146a731a14e6f8"
  content: <initial content with header — see template below>
```

After creating, **update MEMORY.md** to store the slug under "Key Colbin Documents":
```
- **Product Backlog**: slug `<new-slug>`
```

### 4.2 Determine Next Entry ID

Read the existing document content. Find the highest `BL-NNN` entry number and increment by 1. If no entries exist, start at `BL-001`.

### 4.3 Format the New Entry

Use this template for each entry:

````markdown
---

### BL-NNN: [Title]

> **Type**: [feature/tech-debt/bug] | **Priority**: [P1-P4] | **Complexity**: [XS-XL] | **Status**: Open
> **Added**: YYYY-MM-DD

**Description**
[Expanded description from user prompt — 2-4 sentences with enough context to understand the ask]

**Affected Workspaces**: `apps/api`, `apps/editor`, etc.

**Key Files**
| File | Purpose | Action |
|------|---------|--------|
| `path/to/file.ts` | What this file does | Create/Modify |

**Blast Radius**
[1-2 sentences on what systems/layers are touched]

**Risks**
- [Risk 1]
- [Risk 2]

**Related Code**
- [Existing pattern, TODO, or dependency worth noting]

**Implementation Hints**
- [Hint 1: enough for /build to start]
- [Hint 2]
````

### 4.4 Prepend to Document

Read the current document content, then **prepend** the new entry after the document header (so newest entries appear first).

Use `colbin_update_document_content` to write the updated content.

### Document Header Template (for first-run creation)

````markdown
# Colbin Product Backlog

> Living backlog register. Each entry contains codebase context for handoff to `/build`.
> Newest entries first. Use `/backlog mark BL-NNN done` to update status.

**Legend**: Open | ==blue::In Progress== | ==green::Done== | ==red::Cancelled==
````

---

## Phase 4b: STATUS UPDATE

When the prompt contains `mark BL-NNN <status>`:

1. Read the backlog document using the stored slug
2. Find the entry matching `BL-NNN`
3. Update the Status field in the entry's header:
   - `done` → `==green::Done==`
   - `in-progress` → `==blue::In Progress==`
   - `cancelled` → `==red::Cancelled==`
   - `open` → `Open`
4. Write the updated content using `colbin_update_document_content`
5. Display confirmation

---

## Phase 5: OUTPUT

### New Entry Confirmation

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  BACKLOG ENTRY ADDED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Entry:      BL-NNN
Title:      [Title]
Type:       [feature/tech-debt/bug]
Priority:   [P1-P4]
Complexity: [XS-XL]
Files:      [N] key files identified

Backlog: [Colbin Product Backlog](doc-url)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tip: Run `/build [Title]` to start implementing this entry.

Skill: /backlog
File:  .claude/skills/backlog/SKILL.md
```

### Status Update Confirmation

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  BACKLOG UPDATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Entry:  BL-NNN — [Title]
Status: [old status] → [new status]

Backlog: [Colbin Product Backlog](doc-url)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /backlog
File:  .claude/skills/backlog/SKILL.md
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Colbin MCP fails to read/create doc | Retry once, then inform user |
| Backlog doc was deleted | Create a new one, update MEMORY.md |
| Entry ID not found for status update | List available IDs, ask user to confirm |
| Duplicate title detected | Warn user, still create (different IDs) |

---

## Phase 6: SELF-HEALING

**After every `/backlog` execution**, run this phase to keep the skill accurate.

### 6.1 Evaluate Skill Accuracy

Re-read this skill file and compare its instructions against what actually happened during execution:

| Check | What to look for |
|-------|-----------------|
| **MCP tool names** | Did any `colbin_*` MCP calls fail because the tool name, parameter name, or syntax changed? |
| **Document format** | Did the Colbin document render correctly? Were highlights (`==green::Done==`), callout syntax, or tables broken? |
| **Entry template** | Did the entry format need manual adjustment? Are all fields still relevant? |
| **Status update parsing** | Did `mark BL-NNN <status>` parsing work correctly? Were there edge cases (e.g., different casing, missing ID)? |
| **MEMORY.md integration** | Was the backlog slug stored/retrieved correctly? Did the key name match? |
| **Research phase** | Were 3-5 tool calls sufficient? Did Grep/Glob patterns find relevant files? |
| **ID sequencing** | Was the next `BL-NNN` ID calculated correctly from existing entries? |

### 6.2 Fix Issues Found

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

---

## Tips

- Keep entries concise — this is a backlog, not a design doc
- If research reveals the idea is trivial (XS), suggest just doing it now instead of backlogging
- If research reveals the idea is massive (XL+), suggest breaking it into multiple entries
- The backlog document is append-only for entries — never delete entries, only update status
