---
name: code-optimizer
user-invocable: true
disable-model-invocation: false
description: Analyzes code changes against Linty project patterns and catches common issues. Runs checks for dead code, typing violations, missing reuse opportunities, Rust anti-patterns, React anti-patterns, and file organization issues. Triggers on "optimize", "review code", "check code", "code review".
---

# Code Optimizer

Analyzes code in the Linty project against known patterns and conventions. Catches issues that linters miss: architectural anti-patterns, missed reuse opportunities, naming violations, and Linty-specific gotchas.

## When to Use

- Before committing changes (`/code-optimizer` on staged files)
- After implementing a feature (review changed files)
- During code review of a PR
- When refactoring existing code

---

## Project Context

**App**: Tauri v2 + React 19 + Rust — macOS voice-to-text desktop app
**GitHub**: `lintyai/linty`

| Area | Path | Stack |
|------|------|-------|
| Frontend | `src/` | React 19 + Vite + Tailwind + Zustand |
| Backend | `src-tauri/src/` | Rust + Tauri 2 + cpal + whisper-rs |
| Config | `src-tauri/` | Cargo.toml, tauri.conf.json, Entitlements.plist |

**File naming convention**: `Name.type.ext` (two-dot pattern)
- Components: `ComponentName.component.tsx`
- Dialogues/Modals: `DialogName.dialogue.tsx`
- Pages: `PageName.page.tsx`
- Stores: `name.store.ts`
- Slices: `name.slice.ts`
- Hooks: `useName.hook.ts`
- Services: `name.service.ts`
- Types: `name.types.ts`
- Config: `name.config.ts`
- Utilities: `name.util.ts`

---

## Phase 1: GATHER

Identify the files to analyze.

### Option A: Changed files (default)

```bash
git diff main --name-only -- '*.ts' '*.tsx' '*.rs'
```

### Option B: Specific path

```bash
find <path> -name '*.ts' -o -name '*.tsx' -o -name '*.rs' | head -100
```

### Option C: PR files

```bash
gh pr diff <pr-number> --name-only | grep -E '\.(ts|tsx|rs)$'
```

Read every file in the changeset.

---

## Phase 2: ANALYZE

Run every check below against every file in the changeset. Track findings as `{ file, line, code, severity, message }`.

### Severity Levels

| Level | Meaning |
|-------|---------|
| **ERROR** | Must fix before merging. Will cause bugs, crashes, or violates critical conventions. |
| **WARN** | Should fix. Degrades quality, maintainability, or violates conventions. |
| **INFO** | Consider fixing. Minor improvement or style suggestion. |

---

### Category: Cleanup

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `LOG` | ERROR | No `console.log` / `console.debug` in production code | Grep for `console\.(log\|debug\|info)`. Exclude test files. |
| `DEAD` | WARN | No dead code: commented-out blocks, unused functions | Look for `// ...code...` blocks >3 lines, functions with zero call sites. |
| `DEBUG` | ERROR | No debug artifacts in committed code | Grep for `debugger`, `// TODO: remove`, `// HACK`, `// @ts-ignore`. |
| `UNUSED_IMPORT` | WARN | No unused imports | Check each import — is it referenced in the file body? |

---

### Category: TypeScript Typing

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `ANY` | ERROR | No `any` type usage | Grep for `: any`, `as any`, `<any>`, `Record<string, any>`. |
| `PROPS` | WARN | All React components must have typed props | Find components without typed props parameter. |
| `ID_NAMING` | WARN | ID fields must include entity name | Generic `id` should be `transcriptId`, `settingId`, etc. |

---

### Category: Rust Quality

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `UNWRAP` | ERROR | No `.unwrap()` in production Rust code | Grep for `.unwrap()` in `src-tauri/src/`. Use `?` operator or proper error handling. |
| `CLONE` | WARN | Avoid unnecessary `.clone()` | Check if borrow would work instead. |
| `MUTEX_HOLD` | ERROR | Don't hold `MutexGuard` across `.await` | If a `lock()` result is held while calling async code, flag it. |
| `UNSAFE` | WARN | Minimize `unsafe` blocks | Check if safe alternative exists. Document why `unsafe` is necessary. |
| `FFI_SAFETY` | ERROR | All ObjC FFI must handle null pointers | Check `msg_send!` calls for null receiver handling. |
| `TAURI_CMD` | WARN | Tauri commands should return `Result<T, String>` | Commands returning raw types can't propagate errors to frontend. |

---

### Category: Reuse (Frontend)

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `ZUSTAND` | WARN | Use Zustand store slices for global state | If a file creates new `React.createContext` for global state, suggest Zustand. |
| `HOOKS` | INFO | Check for existing hooks before creating new ones | If creating `useXxx`, search `src/hooks/` for similar hooks. |
| `TAURI_API` | WARN | Use `@tauri-apps/api` for Tauri operations | If using raw `window.__TAURI__`, suggest the proper API import. |

---

### Category: Frontend Patterns

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `EFFECT` | WARN | No unnecessary `useEffect` — prefer derived state | If `useEffect` sets state computable from props/state, suggest `useMemo`. |
| `MEMO` | INFO | Expensive computations should use `useMemo` | `.filter()`, `.map()`, `.sort()` on arrays in render body. |
| `LOADING` | WARN | All async operations must have loading states | If Tauri `invoke()` results are used without loading state. |
| `ERROR_UI` | WARN | All async operations must have error states | If Tauri `invoke()` calls lack error handling. |
| `IPC_TYPE` | WARN | Tauri IPC calls must have typed responses | If `invoke<any>()` or untyped invoke calls exist. |

---

### Category: Tauri / macOS Patterns

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `ENTITLEMENT` | ERROR | Hardened Runtime entitlements must be correct | If modifying entitlements, verify `device.audio-input` (NOT `device.microphone`). |
| `TCC` | WARN | Don't assume TCC prompts appear | After requesting mic permission, handle the "already denied" case. |
| `ACTIVATION` | ERROR | Never set `LSUIElement` in Info.plist | Use programmatic `set_activation_policy_accessory/regular()` instead. |
| `ZERO_COPY` | WARN | Audio samples should stay in Rust | Don't send raw audio buffers over IPC — transcribe in-place. |
| `STATE_LOCK` | WARN | Keep `Mutex` lock duration minimal | Lock, clone/take what you need, drop lock. Don't hold across I/O. |

---

### Category: File Organization

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `FILE_NAME` | WARN | Follow two-dot naming convention | If `.tsx` component is `MyComponent.tsx` instead of `MyComponent.component.tsx`. |
| `FILE_SIZE` | WARN | No files >500 lines | Check line count. |
| `IMPORT_ORDER` | INFO | External libs -> @tauri-apps -> relative imports | Check if imports are grouped correctly. |
| `DIALOGUE` | WARN | Modal/dialog components must use `.dialogue.tsx` | If a component renders `<Dialog>` and isn't `.dialogue.tsx`. |

---

## Phase 3: REPORT

Present findings grouped by severity, then by category.

### Report Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CODE OPTIMIZER REPORT — lintyai/linty
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Files analyzed: <count>
Issues found:  <count> (<errors> errors, <warnings> warnings, <infos> info)

── ERRORS (must fix) ──────────────────────────────────

[LOG] src/hooks/useRecording.hook.ts:42
  console.log('debug data:', data);
  Fix: Remove console.log statement.

[UNWRAP] src-tauri/src/audio.rs:87
  let device = host.default_input_device().unwrap();
  Fix: Use `.ok_or("No input device")?.` instead.

── WARNINGS (should fix) ──────────────────────────────

[EFFECT] src/pages/Dashboard.page.tsx:28
  useEffect(() => { setFiltered(items.filter(...)) }, [items]);
  Fix: const filtered = useMemo(() => items.filter(...), [items]);

── INFO (consider fixing) ─────────────────────────────

[MEMO] src/pages/History.page.tsx:18
  const sorted = transcripts.sort((a, b) => b.date - a.date);
  Fix: Wrap in useMemo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Category           | Errors | Warnings | Info |
|--------------------|--------|----------|------|
| Cleanup            | 1      | 0        | 0    |
| TypeScript         | 0      | 0        | 0    |
| Rust Quality       | 1      | 0        | 0    |
| Frontend Patterns  | 0      | 1        | 1    |
| Tauri / macOS      | 0      | 0        | 0    |
| File Organization  | 0      | 0        | 0    |
|--------------------|--------|----------|------|
| TOTAL              | 2      | 1        | 1    |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /code-optimizer
File:  .claude/skills/code-optimizer/SKILL.md
```

---

## Phase 4: AUTO-FIX (Optional)

If the user requests fixes (`/code-optimizer --fix`), apply automatic fixes for safe categories only:

### Safe to auto-fix:
- `LOG` — Remove console.log statements
- `UNUSED_IMPORT` — Remove unused imports
- `IMPORT_ORDER` — Reorder imports

### NOT safe to auto-fix:
- `ANY` — Choosing the correct type requires context
- `UNWRAP` — Error handling strategy requires understanding
- `EFFECT` — Refactoring effects needs understanding of intent
- `FILE_NAME` — Renaming files affects imports across the codebase
- Everything in Tauri / macOS category

---

## Quick Commands

```bash
# Find console.log in changed files
git diff main --name-only -- '*.ts' '*.tsx' | xargs grep -n "console\.\(log\|debug\|info\)" 2>/dev/null

# Find any types in changed files
git diff main --name-only -- '*.ts' '*.tsx' | xargs grep -n ": any\|as any\|<any>" 2>/dev/null

# Find .unwrap() in Rust code
grep -rn "\.unwrap()" src-tauri/src/ --include='*.rs' | head -20

# Large files (>500 lines)
find src src-tauri/src -name "*.tsx" -o -name "*.ts" -o -name "*.rs" | xargs wc -l 2>/dev/null | awk '$1 > 500 {print}' | sort -rn | head -20

# Find components not following naming convention
find src -name "*.tsx" | grep -v "\.component\.\|\.page\.\|\.dialogue\.\|\.test\.\|\.spec\.\|main\.tsx\|App\.tsx\|capsule-main" | head -20
```
