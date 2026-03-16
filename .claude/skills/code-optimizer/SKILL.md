---
name: code-optimizer
user-invocable: true
disable-model-invocation: false
description: Analyzes code changes against Colbin project patterns and catches common issues. Runs checks for dead code, typing violations, missing reuse opportunities, backend anti-patterns, frontend anti-patterns, and file organization issues. Triggers on "optimize", "review code", "check code", "code review".
---

# Code Optimizer

Analyzes code in the Colbin monorepo against known patterns and project conventions. Catches issues that linters miss: architectural anti-patterns, missed reuse opportunities, naming violations, and Colbin-specific gotchas.

## When to Use

- Before committing changes (`/code-optimizer` on staged files)
- After implementing a feature (review changed files)
- During code review of a PR
- When refactoring existing code
- When onboarding to an unfamiliar area of the codebase

---

## Project Context

**Monorepo**: Yarn workspaces + Turborepo
**GitHub**: `shekhardtu/colbin`

| Workspace | Path | Stack |
|-----------|------|-------|
| `@colbin/api` | `apps/api/` | Express + TSOA + Mongoose + MongoDB |
| `@colbin/editor` | `apps/editor/` | React 19 + Vite 6 + Tailwind + shadcn/ui + Zustand |
| `block-editor` | `packages/block-editor/` | ProseMirror + Y.js |
| `magic-input` | `packages/magic-input/` | ProseMirror input rules |
| `hagen-client` | `packages/hagen-client/` | Generated TypeScript API client |
| `shared-utils` | `packages/shared-utils/` | Shared utilities |
| `websocket` | `packages/websocket/` | WebSocket utilities |
| `storage` | `packages/storage/` | Storage utilities |
| `canvas-editor` | `packages/canvas-editor/` | Canvas-based editor |
| `retry` | `packages/retry/` | Retry logic |

**File naming convention**: `Name.type.ext` (two-dot pattern)
- Components: `ComponentName.component.tsx`
- Dialogues/Modals: `DialogName.dialogue.tsx`
- Pages: `PageName.page.tsx`
- Layouts: `LayoutName.layout.tsx`
- Stores: `name.store.ts`
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
# Staged + unstaged changes vs main
git diff main --name-only -- '*.ts' '*.tsx'
```

### Option B: Specific path (if user provides one)

```bash
# All TS/TSX files under the given path
find <path> -name '*.ts' -o -name '*.tsx' | head -100
```

### Option C: PR files

```bash
gh pr diff <pr-number> --name-only | grep -E '\.(ts|tsx)$'
```

Read every file in the changeset. If there are more than 30 files, batch into groups and analyze incrementally.

---

## Phase 2: ANALYZE

Run every check below against every file in the changeset. Track findings as a flat list of `{ file, line, code, severity, message }` objects.

### Severity Levels

| Level | Meaning |
|-------|---------|
| **ERROR** | Must fix before merging. Will cause bugs, crashes, or violates critical conventions. |
| **WARN** | Should fix. Degrades quality, maintainability, or violates project conventions. |
| **INFO** | Consider fixing. Minor improvement or style suggestion. |

---

### Category: Cleanup

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `LOG` | ERROR | No `console.log` / `console.debug` / `console.info` in production code | Grep for `console\.(log\|debug\|info)`. Exclude test files (`*.test.*`, `*.spec.*`) and scripts (`scripts/`). |
| `DEAD` | WARN | No dead code: commented-out code blocks, unused functions, unreachable branches | Look for `// ...code...` blocks >3 lines, functions with zero call sites in the changeset, `if (false)` or `return` followed by code. |
| `DEBUG` | ERROR | No debug/test flags left in committed code | Grep for `debugger`, `// TODO: remove`, `// HACK`, `// FIXME`, `// @ts-ignore` (prefer `@ts-expect-error` with explanation), `enabled: false` on features that should be on. |
| `UNUSED_IMPORT` | WARN | No unused imports | Check each import — is it referenced in the file body? TypeScript compiler catches most, but `import type` sometimes slips through. |

---

### Category: Typing

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `ANY` | ERROR | No `any` type usage | Grep for `: any`, `as any`, `<any>`, `Record<string, any>`. Suggest the correct type or `unknown`. |
| `PROPS` | WARN | All React components must have typed props interface | Find `const X: FC = ` or `function X(props)` without a typed props parameter. Every component should have `FC<XProps>` or `(props: XProps)`. |
| `HAGEN_TYPE` | WARN | Use types from `@shekhardtu/hagen-client` for API data | If a file defines an interface that mirrors an API response shape, check if the same type exists in `hagen-client`. Import it instead of duplicating. |
| `ID_NAMING` | WARN | ID fields must include collection name | Generic `id` parameters or properties should be `userId`, `orgId`, `documentId`, `sessionRoomId`, etc. Exception: destructured `_id` from Mongoose documents. |
| `MONGOOSE_TYPE` | WARN | Use Mongoose document types, not raw object shapes | If defining interfaces for Mongoose documents, check if the model file already exports `IDocument`, `IUser`, etc. |

---

### Category: Reuse

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `SHADCN` | WARN | Use shadcn/ui components before creating custom UI | If a file creates a custom `<Button>`, `<Dialog>`, `<Input>`, `<Select>`, `<Tooltip>`, etc., check `apps/editor/src/components/ui/` for existing shadcn components. |
| `ZUSTAND` | WARN | Use Zustand stores for new global state (not React Context) | If a file creates a new `React.createContext` for global state, suggest Zustand instead. Context is fine for scoped/specialized concerns (WebSocket, Y.js). |
| `HOOKS` | INFO | Check for existing hooks before creating new ones | If a file creates a `useXxx` hook, search `apps/editor/src/hooks/` for similar existing hooks. |
| `SHARED_UTILS` | INFO | Check `packages/shared-utils` for existing utilities | If a file defines a utility function (date formatting, string manipulation, etc.), check if it already exists in `packages/shared-utils/`. |
| `HAGEN_CLIENT` | WARN | Use generated API client for network calls | If a file uses raw `fetch()` or `axios` for API calls, check if the endpoint exists in `@shekhardtu/hagen-client`. |

---

### Category: Backend Patterns (apps/api/)

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `TSOA_DTO` | ERROR | All TSOA controller inputs must use explicit DTO interfaces (no utility types) | If a `@Body()` parameter uses `Omit<>`, `Pick<>`, or `Partial<>`, flag it. TSOA breaks with utility types + generic return types. Create an explicit DTO interface instead. |
| `TSOA_RESPONSE` | WARN | Controllers must use `BackendSuccessResponse<T>` envelope pattern | If a controller method returns a raw object or `Promise<SomeType>` without the `BackendSuccessResponse` wrapper, flag it. |
| `ES_MODULE` | ERROR | All local imports must include `.js` extension | Grep for `from '\./` or `from '\.\./` NOT ending in `.js'`. This project uses ES modules — missing `.js` causes runtime crashes. |
| `MONGOOSE_COLLECTION` | WARN | Raw MongoDB queries must use correct pluralized collection names | If using `mongoose.connection.db.collection('xxx')`, verify the name matches Mongoose's auto-pluralization (e.g., `document_checkpoint` -> `document_checkpoints`). |
| `APP_SOURCE` | ERROR | All document queries must include `appSource: "editor"` filter | If querying the Document model/collection without `appSource`, flag it. The database is shared across multiple applications. |
| `N_PLUS_1` | WARN | Avoid N+1 queries | If a loop body contains a `Model.findOne()`, `Model.findById()`, or similar query, suggest batching with `Model.find({ _id: { $in: ids } })`. |
| `RESPONSE_TYPE` | WARN | Use `createSuccessResponse()` with `RESPONSE_TYPES` constant | If a controller manually constructs response objects instead of using the helper, flag it. |
| `ENV_PATH` | WARN | Environment variables load from `config/.env` | If code references `process.env` and loads dotenv from wrong path, flag it. |

---

### Category: Frontend Patterns (apps/editor/)

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `EFFECT` | WARN | No unnecessary `useEffect` — prefer derived state | If a `useEffect` sets state that could be computed directly from existing state/props (derived state), suggest `useMemo` or inline computation. Pattern: `useEffect(() => { setX(compute(a, b)) }, [a, b])` -> `const x = useMemo(() => compute(a, b), [a, b])`. |
| `MEMO` | INFO | Expensive computations should use `useMemo` | If a render body contains `.filter()`, `.map()`, `.reduce()`, `.sort()` on arrays that don't change every render, suggest `useMemo`. |
| `CALLBACK` | INFO | Handlers passed as props should use `useCallback` | If an inline arrow function is passed as a prop to a child component (especially in lists), suggest `useCallback`. |
| `FORM` | WARN | Use react-hook-form for forms | If a component manages multiple form fields with individual `useState` calls, suggest react-hook-form + zod validation. |
| `LOADING` | WARN | All async operations must have loading states | If `useQuery` or `useMutation` results are used without checking `isLoading`/`isPending`, flag it. |
| `ERROR_UI` | WARN | All async operations must have error states | If `useQuery` or `useMutation` results are used without checking `isError`/`error`, flag it. |
| `A11Y` | WARN | Interactive elements must have ARIA attributes | If `<div onClick>` or `<span onClick>` lacks `role`, `tabIndex`, `aria-label`, or `onKeyDown`, flag it. |
| `CN_UTILITY` | INFO | Use `cn()` for conditional Tailwind classes | If ternary expressions build className strings instead of using the `cn()` utility from `@/lib/utils`, suggest it. |

---

### Category: File Organization

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `FILE_NAME` | WARN | Follow two-dot naming convention | If a `.tsx` component file is named `MyComponent.tsx` instead of `MyComponent.component.tsx`, flag it. Similarly for pages, hooks, stores, services, types, dialogues/modals. |
| `FILE_SIZE` | WARN | No files >500 lines | Check line count. If >500, suggest extracting into separate files. |
| `IMPORT_ORDER` | INFO | External libs -> internal packages (`@/`, `@colbin/`) -> relative imports (`./`, `../`) | Check if imports are grouped and ordered correctly. |
| `DIALOGUE` | WARN | Modal/dialog components must use `.dialogue.tsx` extension | If a component renders `<Dialog>`, `<AlertDialog>`, or `<Modal>` and is NOT named `.dialogue.tsx`, flag it. |
| `COMPONENT_ORDER` | INFO | React component internals should follow standard order | Check: 1) Zustand stores, 2) Hooks, 3) Local state, 4) Derived/memo, 5) Callbacks, 6) Effects, 7) Render. |

---

### Category: WebSocket & Collaboration

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `WS_SEPARATION` | ERROR | Y.js WebSocket is for document collaboration ONLY | If non-collaboration events (chat, notifications) are sent through Y.js awareness/state, flag it. |
| `SCOPE_VS_PERM` | ERROR | ShareLink controls VISIBILITY (scope), SessionRoom.publicAccess controls PERMISSIONS | If code reads permission level from a ShareLink object instead of SessionRoom.publicAccess, flag it. |
| `ROLE_VS_ACCESS` | WARN | `role` is for org membership, `accessLevel` is for document participants | If code uses `role` where `accessLevel` is meant (or vice versa), flag it. |

---

### Category: Monorepo & Dependencies

| Code | Severity | Check | How to Detect |
|------|----------|-------|---------------|
| `RESOLUTION` | ERROR | Check for version conflicts when adding dependencies | If a new dependency appears in the changeset's `package.json`, grep `yarn.lock` for multiple resolutions of the same package. |
| `DYNAMIC_IMPORT` | WARN | Non-critical features should use dynamic imports | If a static `import` pulls in an optional package (e.g., MCP SDK, analytics), suggest `await import()` with try/catch. |

---

## Phase 3: REPORT

Present findings grouped by severity, then by category.

### Report Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CODE OPTIMIZER REPORT — shekhardtu/colbin
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Files analyzed: <count>
Issues found:  <count> (<errors> errors, <warnings> warnings, <infos> info)

── ERRORS (must fix) ──────────────────────────────────

[LOG] apps/editor/src/features/document/DocumentEditor.component.tsx:42
  console.log('debug data:', data);
  Fix: Remove console.log statement.

[ANY] apps/api/src/features/user/user.service.ts:87
  const result: any = await User.findById(userId);
  Fix: Use `IUser | null` (from user.model.ts).

[TSOA_DTO] apps/api/src/features/document/document.controller.ts:55
  @Body() data: Omit<DocumentCreateDto, "createdById">
  Fix: Create an explicit `DocumentRequestDto` interface without
  the `createdById` field. TSOA breaks with utility types.

[ES_MODULE] apps/api/src/features/auth/auth.service.ts:3
  import { hashPassword } from './auth.utils';
  Fix: Add .js extension: './auth.utils.js'

[APP_SOURCE] apps/api/src/features/document/document.service.ts:120
  Document.find({ organizationId: orgId, status: { $ne: "DELETED" } })
  Fix: Add `appSource: "editor"` to the query filter.

── WARNINGS (should fix) ──────────────────────────────

[EFFECT] apps/editor/src/features/dashboard/DocumentList.component.tsx:28
  useEffect(() => { setFilteredDocs(docs.filter(d => d.status === 'active')) }, [docs]);
  Fix: Replace with derived state:
    const filteredDocs = useMemo(() => docs.filter(d => d.status === 'active'), [docs]);

[FILE_NAME] apps/editor/src/components/ShareDialog.tsx
  Fix: Rename to ShareDocument.dialogue.tsx (modal component using <Dialog>).

[ID_NAMING] apps/api/src/features/participant/participant.service.ts:15
  function addParticipant(id: string, roomId: string)
  Fix: Use `userId` and `sessionRoomId` for clarity.

[HAGEN_TYPE] apps/editor/src/types/document.ts:5
  interface Document { title: string; slug: string; ... }
  Fix: Import from @shekhardtu/hagen-client instead of duplicating.

── INFO (consider fixing) ──────────────────────────────

[MEMO] apps/editor/src/features/dashboard/RecentDocuments.component.tsx:18
  const sorted = documents.sort((a, b) => b.updatedAt - a.updatedAt);
  Fix: Wrap in useMemo to avoid re-sorting on every render.

[IMPORT_ORDER] apps/editor/src/features/editor/EditorToolbar.component.tsx:1-8
  Relative import before absolute import.
  Fix: Reorder: external libs -> @/ imports -> ./ imports.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Category           | Errors | Warnings | Info |
|--------------------|--------|----------|------|
| Cleanup            | 1      | 0        | 0    |
| Typing             | 1      | 2        | 0    |
| Reuse              | 0      | 1        | 0    |
| Backend Patterns   | 2      | 0        | 0    |
| Frontend Patterns  | 0      | 1        | 1    |
| File Organization  | 0      | 1        | 1    |
| WebSocket/Collab   | 0      | 0        | 0    |
| Monorepo/Deps      | 0      | 0        | 0    |
|--------------------|--------|----------|------|
| TOTAL              | 4      | 5        | 2    |

Recommendation: Fix all ERRORS before merging. Address WARNINGS
in this PR if scope allows, otherwise create follow-up issues.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /code-optimizer
File:  .claude/skills/code-optimizer/skill.md
```

---

## Phase 4: AUTO-FIX (Optional)

If the user requests fixes (`/code-optimizer --fix`), apply automatic fixes for safe categories only:

### Safe to auto-fix:
- `LOG` — Remove `console.log` / `console.debug` / `console.info` statements
- `UNUSED_IMPORT` — Remove unused imports
- `ES_MODULE` — Add missing `.js` extensions to local imports
- `IMPORT_ORDER` — Reorder imports to match convention
- `CN_UTILITY` — Replace ternary className with `cn()` calls

### NOT safe to auto-fix (require human judgment):
- `ANY` — Choosing the correct type requires context
- `EFFECT` — Refactoring effects needs understanding of intent
- `FILE_NAME` — Renaming files affects imports across the codebase
- `TSOA_DTO` — Creating new DTO interfaces requires design decisions
- `N_PLUS_1` — Query optimization requires understanding data access patterns
- Everything in WebSocket & Collaboration category

For auto-fixes:
1. Read the file
2. Apply the fix using Edit tool
3. Mark the finding as `FIXED` in the report
4. After all fixes, re-run `yarn typecheck` on affected workspaces to verify

---

## Phase 5: SELF-HEALING

**After every `/code-optimizer` execution**, run this phase to keep the skill accurate.

### 5.1 Evaluate Skill Accuracy

Re-read this skill file and compare its instructions against what actually happened during execution:

| Check | What to look for |
|-------|-----------------|
| **Check codes** | Did any check produce false positives consistently? Should thresholds or patterns be adjusted? |
| **File paths** | Did referenced paths (`apps/editor/`, `apps/api/`, `packages/`) still match the actual codebase structure? |
| **Tool names** | Did grep patterns or glob patterns fail to match expected files? |
| **Stack accuracy** | Did the project context section (Express + TSOA, React 19, etc.) match reality? |
| **New patterns** | Did the codebase introduce new conventions not yet covered by a check code? |
| **False negatives** | Were there issues found manually that no check code caught? |

### 5.2 Fix Issues Found

If any discrepancies were found:
1. Use the `Edit` tool to fix the specific inaccurate section in this skill file
2. Keep changes minimal and targeted — fix only what is wrong
3. Log each fix:

```
Self-Healing Log:
- Fixed: <what was wrong> -> <what it was changed to>
- Reason: <why the original was inaccurate>
```

If nothing needs fixing, skip silently.

### 5.3 Common Self-Healing Scenarios

| Scenario | Action |
|----------|--------|
| New shadcn/ui component added to project | No change needed — `SHADCN` check already searches `apps/editor/src/components/ui/` |
| Project migrates to a different ORM | Update Backend Patterns category: replace `MONGOOSE_*` checks with equivalent checks for the new ORM |
| New package added to monorepo | Add to Project Context table |
| File naming convention changes | Update convention table and `FILE_NAME` check |
| TSOA replaced with different framework | Update `TSOA_DTO`, `TSOA_RESPONSE`, and `RESPONSE_TYPE` checks |
| New React pattern adopted (e.g., Server Components) | Add corresponding check code to Frontend Patterns |

---

## Quick Commands

These commands help manually spot-check before running the full optimizer:

```bash
# Find console.log in changed files
git diff main --name-only -- '*.ts' '*.tsx' | xargs grep -n "console\.\(log\|debug\|info\)" 2>/dev/null

# Find any types in changed files
git diff main --name-only -- '*.ts' '*.tsx' | xargs grep -n ": any\|as any\|<any>" 2>/dev/null

# Find missing .js extensions in API imports
grep -rn "from '\.\." apps/api/src/ --include='*.ts' | grep -v "\.js'" | grep -v node_modules | head -20

# Find files missing appSource in document queries
grep -rn "Document\.\(find\|findOne\|countDocuments\|aggregate\)" apps/api/src/ --include='*.ts' | grep -v "appSource" | head -20

# Large files (>500 lines)
find apps packages -name "*.tsx" -o -name "*.ts" | xargs wc -l 2>/dev/null | awk '$1 > 500 {print}' | sort -rn | head -20

# Find components not following naming convention
find apps/editor/src -name "*.tsx" | grep -v "\.component\.\|\.page\.\|\.dialogue\.\|\.layout\.\|\.test\.\|\.spec\.\|/ui/" | head -20

# Find modals/dialogs not using .dialogue.tsx
grep -rln "<Dialog\|<AlertDialog\|<Modal" apps/editor/src/ --include='*.tsx' | grep -v "\.dialogue\.\|/ui/\|\.test\.\|\.spec\." | head -10

# Find React Context used for global state (should be Zustand)
grep -rn "createContext" apps/editor/src/ --include='*.tsx' --include='*.ts' | grep -v node_modules | head -10
```

---

## Decision Flowcharts

### Before adding new code

```
Need a UI component?
  -> Check shadcn/ui (apps/editor/src/components/ui/)
    -> Exists? USE IT
    -> Doesn't exist? Check shadcn/ui docs for installable component
      -> Installable? `npx shadcn@latest add <component>`
      -> Not available? Create custom in apps/editor/src/components/

Need a type?
  -> API response shape? Check @shekhardtu/hagen-client
  -> Mongoose document? Check the model file's exported interface
  -> React props? Create interface in same file or co-located .types.ts
  -> Shared constant? Check packages/shared-utils or hagen-client
  -> None of the above? Create in the feature's .types.ts file

Need a hook?
  -> Check apps/editor/src/hooks/ for existing hooks
  -> Check if a Zustand store selector would work instead
  -> Create new hook only if neither option fits

Need state management?
  -> Truly global state (auth, layout, editor config)? Zustand store
  -> Scoped/specialized concern (WebSocket, Y.js)? React Context
  -> Server state (API data)? React Query / SWR
  -> Form state? react-hook-form
  -> Local component state? useState
```

### Where to put a new file

```
Used by multiple workspaces (api + editor)?
  -> packages/shared-utils/ or packages/shared-types/

Used only by API?
  -> apps/api/src/features/<feature-name>/

Used only by Editor?
  -> Feature-specific? apps/editor/src/features/<feature-name>/
  -> Reusable component? apps/editor/src/components/
  -> Global hook? apps/editor/src/hooks/
  -> Store slice? apps/editor/src/store/

Used by block-editor?
  -> packages/block-editor/
```
