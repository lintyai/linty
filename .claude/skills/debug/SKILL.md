---
name: debug
user-invocable: true
disable-model-invocation: false
description: Systematic application debugging using Google SRE methodology. Traces issues through all observability layers — health endpoints, performance metrics, WebSocket security, Sentry errors, database state, Redis cache, auth tokens, frontend data flow, and Y.js collaboration. Runs build verification after fix. Triggers on "debug this", "debug the app", "why is this failing", "trace the issue", "find the bug", "debug build", "debug error".
---

# Debug — Systematic Application Debugging

Strategic, methodical debugging modeled after [Google SRE's troubleshooting methodology](https://sre.google/sre-book/effective-troubleshooting/) and [Netflix's distributed tracing approach](https://netflixtechblog.com/lessons-from-building-observability-tools-at-netflix-7cfafed6ab17). Follows the **hypothetico-deductive method**: observe, theorize, test, confirm, fix, verify.

## Core Principle: Trace Correlation

Debug traces signals across every observability layer to reconstruct the full request lifecycle:

```
 User Action
     |
     v
 [Frontend]  React component → Zustand store → API service call
     |
     v
 [Network]   HTTP request (JWT auth) / WebSocket (Y.js CRDT)
     |
     v
 [API Layer] Express middleware → TSOA controller → Service → Repository
     |                                                    |
     v                                                    v
 [Data]      MongoDB (Mongoose)                    Redis (cache)
     |
     v
 [Real-time] Hocuspocus → Y.js document → Awareness protocol
     |
     v
 [Monitoring] Sentry errors | Prometheus metrics | Winston logs | WS Security Monitor
```

## When to Use

- Application throws errors (API 4xx/5xx, frontend crashes, WebSocket failures)
- Feature behaves incorrectly (wrong data, stale state, missing content)
- Performance degradation (slow queries, high latency, timeouts)
- Build failures after code changes
- Collaboration issues (Y.js sync, CRDT corruption, presence failures)
- Auth problems (token expiry, permission denied, silent failures)
- Cache inconsistencies (stale data, encoding mismatches)

## When NOT to Use

- Production-only issues with no local reproduction → use `/rca` instead
- You know the exact bug already and just need to fix it → fix directly
- Code style/quality issues → use `/code-optimizer` instead

---

## Phase 1: INTAKE — Problem Report

Collect structured information before touching code. Use `AskUserQuestion` if not provided.

### Required Context

| Field | Description | Example |
|-------|-------------|---------|
| **Symptom** | What the user observes | "Document editor shows blank page" |
| **Expected** | What should happen | "Document content should render" |
| **Steps to reproduce** | How to trigger the issue | "Open /bin/abc123, wait 3 seconds" |
| **Scope** | Which layer is affected | API / Frontend / WebSocket / Database / All |
| **Recency** | When it started | "After last commit" / "Always" / "Intermittent" |

### Quick Classification

Classify the issue type to route investigation efficiently:

| Type | Signals | Start At |
|------|---------|----------|
| **API Error** | HTTP 4xx/5xx, timeout, empty response | Phase 3A (API Health) |
| **Frontend Bug** | UI renders wrong, component crash, blank page | Phase 3E (Frontend) |
| **Data Issue** | Wrong data displayed, missing records, stale cache | Phase 3C (Database) |
| **Auth Issue** | 401/403, redirect to login, permission denied | Phase 3D (Auth) |
| **Collaboration** | Y.js sync failure, cursor gone, CRDT corruption | Phase 3F (WebSocket) |
| **Performance** | Slow response, high latency, timeout | Phase 3B (Performance) |
| **Build Failure** | TypeScript errors, module not found, compilation | Phase 3G (Build) |
| **Unknown** | Can't classify yet | Phase 2 (full triage) |

---

## Phase 2: TRIAGE — Stabilize Before Diagnosing

**Google SRE principle**: _"Your first instinct in a major outage may be to start troubleshooting and find root cause. Ignore that instinct. Stabilize first."_

### 2.1 Check System Health (Parallel)

Run ALL of these simultaneously to establish baseline:

```bash
# 1. API health endpoint
curl -s http://localhost:4000/metrics/health | jq .

# 2. Circuit breaker status
curl -s http://localhost:4000/metrics/circuit-breakers | jq .

# 3. Prometheus metrics (raw)
curl -s http://localhost:4000/metrics

# 4. TypeScript compilation check
yarn workspace @colbin/api tsc --noEmit 2>&1 | tail -20

# 5. Frontend compilation check
yarn workspace @colbin/web tsc --noEmit 2>&1 | tail -20
```

### 2.2 Establish What IS Working

**Netflix insight**: _"Understanding what DID load vs what DIDN'T narrows investigation scope by 80%."_

Before investigating what's broken, confirm what's healthy:
- Can you reach the API at all? (`/metrics/health`)
- Is MongoDB connected? (check health response `services.initialized`)
- Is Redis connected? (check health response `services.redis`)
- Are circuit breakers open? (check `/metrics/circuit-breakers` for `anyOpen`)
- Is the WebSocket server accepting connections?
- Does the frontend load the shell (header, sidebar)?

### 2.3 Check Recent Changes

**Google SRE**: _"Systems maintain inertia — they work until external forces act."_

```bash
# What changed recently?
git log --oneline -10

# What files changed in last commit?
git diff HEAD~1 --name-only

# Any uncommitted changes?
git status

# Diff of current changes
git diff
```

If the bug appeared after a specific commit, bisect to confirm:
```bash
git log --oneline -20  # Find the suspect range
# Then manually check the diff of the suspect commit
git diff <commit>~1..<commit>
```

---

## Phase 3: EXAMINE — Systematic Signal Collection

Based on the classification from Phase 1, start with the most relevant layer. Run independent checks in PARALLEL.

### 3A. API Layer Health

#### Endpoints Reference

| Endpoint | Purpose | What It Reveals |
|----------|---------|-----------------|
| `GET /metrics/health` | Service health | MongoDB, Redis, circuit breakers, server ID |
| `GET /metrics/circuit-breakers` | External service health | Which breakers are open/closed, failure counts |
| `GET /metrics` | Prometheus metrics | Request counts, latency histograms, error rates |

#### API Logging

The API uses Winston with configurable log levels:

| Mode | Env Var | Level | Command |
|------|---------|-------|---------|
| Production | `LOGGING=production` | `info` | `yarn dev` |
| Verbose | `LOGGING=verbose` | `debug` | `yarn dev:log` |
| Silent | `LOGGING=silent` | `error` | `LOGGING=silent yarn dev` |

**To debug API issues, restart with verbose logging:**
```bash
# In apps/api/
LOGGING=verbose yarn dev:log
```

Then reproduce the issue and check the console output for:
- Request/response logs with status codes and latency
- Mongoose query logs (collection, operation, duration)
- Error stack traces with full context

#### Error Handling Chain

Trace how errors propagate through the API:

```
Request → Express middleware → TSOA validation → Controller → Service → Repository
                |                    |                              |
                v                    v                              v
         error.middleware      ValidateError (422)           Mongoose errors
         (apps/api/src/       with field details             ApiError factory
          middlewares/                                        (apps/api/src/
          error.ts)                                           utils/errors.util.ts)
```

**Error factory categories** (from `errors.util.ts`):
- `NotFoundError` (404) — user, document, organization, token, apiKey, etc.
- `UnauthorizedError` (401) — invalidCredentials, tokenExpired, invalidToken
- `ForbiddenError` (403) — insufficientPermissions, notRoomAdmin, notOrgMember
- `BadRequestError` (400) — validation, invalidInput, missingField
- `ConflictError` (409) — duplicate, emailTaken
- `InternalError` (500) — database, externalService
- `RateLimitError` (429)

#### Key Files to Read

| File | Purpose |
|------|---------|
| `apps/api/src/config/logger.ts` | Winston logger configuration |
| `apps/api/src/middlewares/error.ts` | Error converter + handler middleware |
| `apps/api/src/utils/errors.util.ts` | Centralized error factory |
| `apps/api/src/utils/performanceMonitoring.ts` | Query tracking + N+1 detection |

---

### 3B. Performance Analysis

#### Query Performance Monitoring

The API has built-in query performance tracking (`performanceMonitoring.ts`):

| Metric | Threshold | Meaning |
|--------|-----------|---------|
| Query time > 100ms | Slow query | Log with context |
| Query count > 10 per request | N+1 detected | Warn in logs |
| Endpoint response time | Tracked per-endpoint | Last 100 samples |

**To check performance:**
```bash
# Get performance report (if endpoint is exposed)
curl -s http://localhost:4000/performance-report | jq .
```

**What to look for:**
- Top offending endpoints by query count (N+1 pattern)
- Average response time per endpoint
- Query time as percentage of total response time

#### Frontend Performance

Check React rendering performance:
- Open browser DevTools → Performance tab → Record → Reproduce issue
- Look for excessive re-renders in React DevTools Profiler
- Check Zustand store subscriptions causing unnecessary updates
- Verify `useMemo`/`useCallback` where expensive computations exist

---

### 3C. Database & Cache Layer

#### MongoDB (Mongoose)

```bash
# Check if MongoDB is reachable (from API health)
curl -s http://localhost:4000/metrics/health | jq '.services.initialized'
```

**Key debugging queries** (use mongosh or read via code):

1. **Document exists and is valid:**
   - Not soft-deleted: `___status !== 'DELETED'`
   - Correct app source: `appSource === 'editor'`
   - Has CRDT state: `crdtState` is not null (for collaboration issues)

2. **User permissions:**
   - User exists in `users` collection
   - `user_org_mappings` links user to organization
   - Document permissions in `document_permissions`

3. **Collection names** (Mongoose pluralization):
   - `users`, `organizations`, `documents`, `user_org_mappings`
   - `document_permissions`, `share_links`, `session_rooms`
   - `document_checkpoints`, `version_snapshots`
   - `refresh_tokens`, `api_keys`

#### Redis Cache

**Known gotcha**: Mongoose `Buffer.toJSON()` corrupts binary data when stored in Redis.

| Format | Where | Why |
|--------|-------|-----|
| `Buffer` | MongoDB, API return values | Native binary |
| base64 `string` | Redis cache, HTTP responses | JSON-safe |
| `Uint8Array` | Y.js / Hocuspocus | Y.js API requirement |

**Check for cache issues:**
- Stale document cache after updates
- Buffer encoding mismatch (base64 vs `{ type: "Buffer", data: [...] }`)
- Cache invalidation not triggered

**Reference:** `DocumentService.normalizeCrdtState()` and `prepareCrdtStateForCache()` in `apps/api/src/features/document/document.service.ts`

---

### 3D. Auth Layer

Colbin uses JWT access tokens (15m) + DB-stored refresh tokens (7d) with rotation.

**Auth debugging checklist:**

| Check | How |
|-------|-----|
| Token expired? | Decode JWT — check `exp` claim vs current time |
| Refresh token valid? | Check `refresh_tokens` collection — not revoked, not expired |
| User in org? | Check `user_org_mappings` for userId + orgId |
| Role sufficient? | Check role in `user_org_mappings` (Owner > Admin > Member) |
| Token rotation? | Each refresh creates new token — old one invalidated |

**Frontend auth flow:**
```
Access token (15m) → API request
    |
    v (if 401)
Refresh token (7d) → POST /auth/refresh → New access + refresh tokens
    |
    v (if refresh fails)
Redirect to login
```

**Key files:**
| File | Purpose |
|------|---------|
| `apps/api/src/features/auth/` | Auth controllers, services, guards |
| `apps/web/src/stores/auth.store.ts` | Frontend auth state |
| `apps/web/src/services/` | API client with interceptors |

---

### 3E. Frontend Layer

#### Data Flow Tracing

Trace the full data path for the broken feature:

```
Route (apps/web/src/pages/) → Page component
    |
    v
Zustand store (apps/web/src/stores/) → API service call
    |
    v
API response → Store update → React re-render → DOM
```

**Common frontend bugs:**
- Empty state not handled (API returns `[]` or `null`)
- Zustand selector returns stale reference
- Missing loading/error state handling
- API response shape mismatch (paginated `{ data, total }` vs array)
- Missing `appSource: 'editor'` filter in API calls

#### Browser DevTools Checklist

| Tab | What to Check |
|-----|---------------|
| Console | JavaScript errors, React warnings, network failures |
| Network | API call status codes, response payloads, WebSocket frames |
| Application | localStorage (orgId, tokens), sessionStorage |
| React DevTools | Component tree, props/state, re-render counts |

---

### 3F. WebSocket & Collaboration Layer

#### Hocuspocus / Y.js

**Connection lifecycle:**
```
Browser → WebSocket upgrade → Hocuspocus authenticate → Y.js sync → Awareness
```

#### WebSocket Security Monitor

The API has a built-in security monitor (`wsSecurityMonitor.ts`):

| Metric | Details |
|--------|---------|
| Connection attempts | Total, successful, failed, blocked |
| IP tracking | First seen, last seen, success/fail ratio |
| Auth failures | Per IP, with auto-blocking (100 fails → 15min block) |
| Path metrics | `/ws` vs `/yjs` paths |

**To check WS security state** (via code or logs):
```typescript
wsSecurityMonitor.getMetrics()       // Full security metrics
wsSecurityMonitor.getBlockedIPs()    // Currently blocked IPs
wsSecurityMonitor.getAllIpAccess()    // All IP access records
```

**Dev helpers:**
```typescript
wsSecurityMonitor.unblockIP(ip)      // Manual unblock
wsSecurityMonitor.clearAllBlocks()   // Clear all blocks
wsSecurityMonitor.resetMetrics()     // Reset all metrics
```

#### Common Collaboration Issues

| Issue | Likely Cause | Check |
|-------|-------------|-------|
| Blank document | CRDT state null or corrupted | `documents` collection → `crdtState` field |
| Cursor not showing | Awareness protocol failure | WebSocket connection state, `provider.awareness` |
| Edits not syncing | Y.js provider disconnected | Provider status event, network tab WS frames |
| "Already connected" | Shared socket re-attach issue | `provider.attach()` called twice |
| Stale content after refresh | Cache serving old CRDT | Redis cache invalidation, `normalizeCrdtState()` |

**Key files:**
| File | Purpose |
|------|---------|
| `apps/api/src/utils/wsSecurityMonitor.ts` | WS security monitoring |
| `packages/websocket/` | Shared WebSocket connection management |
| `packages/block-editor/` | ProseMirror editor core |

---

### 3G. Build & Compilation

#### Build Commands

| Command | Scope | Purpose |
|---------|-------|---------|
| `yarn workspace @colbin/api tsc --noEmit` | API | TypeScript check only |
| `yarn workspace @colbin/web tsc --noEmit` | Frontend | TypeScript check only |
| `yarn workspace @colbin/api build` | API | Full production build |
| `yarn workspace @colbin/web build` | Frontend | Full production build |
| `yarn build` | All | Turborepo build all packages |
| `yarn validate:imports` | API | Check ES module `.js` extensions |
| `yarn fix:imports` | API | Auto-fix missing `.js` extensions |

#### Common Build Issues

| Error Pattern | Cause | Fix |
|--------------|-------|-----|
| `ERR_MODULE_NOT_FOUND` | Missing `.js` extension in ESM import | Run `yarn fix:imports` |
| `Cannot find module` (in Docker) | Dependency not hoisted to root | Add `resolutions` in root `package.json` |
| Type errors after package update | Breaking type changes | Check package changelog, update types |
| Circular dependency | Modules importing each other | Restructure imports, use barrel exports carefully |

---

## Phase 4: DIAGNOSE — Hypothesis Formation

**Google SRE**: _"Apply divide-and-conquer. Simplify and reduce. Test component interfaces with known inputs."_

### 4.1 Formulate Hypotheses

Based on signals collected in Phase 3, form 2-3 ranked hypotheses:

```
Hypothesis 1 (most likely): <description>
  Evidence for: <what supports this>
  Evidence against: <what contradicts this>
  Test: <how to confirm/refute>

Hypothesis 2: <description>
  Evidence for: ...
  Evidence against: ...
  Test: ...
```

### 4.2 Prioritization Rules

**Google SRE**: _"Not all failures are equally probable. Prefer simpler explanations."_

| Priority | Principle |
|----------|-----------|
| 1st | **Recent changes** — what changed since it last worked? |
| 2nd | **Simple explanations** — Occam's Razor (typo > architecture flaw) |
| 3rd | **Common patterns** — known gotchas from CLAUDE.md and memory |
| 4th | **Correlation ≠ causation** — verify, don't assume |

### 4.3 Known Gotchas (Colbin-Specific)

Check these FIRST — they explain most issues:

| Gotcha | Symptom |
|--------|---------|
| Missing `appSource: 'editor'` in query | Returns cross-app data or empty results |
| `POST` without `Content-Type: application/json` body | Express returns error |
| Document slug endpoint is `GET /documents/slug/:slug` | 404 if using `/documents/:slug` |
| Register expects `{ fullName, username, email, password }` | Validation error on register |
| Paginated API returns `{ data: [], total }` not array | Frontend expects array |
| Redis Buffer corruption (`toJSON()` issue) | CRDT state appears valid but is broken |
| `provider.attach()` not called with shared socket | WebSocket connected but no Y.js sync |
| Mongoose collection names are pluralized with underscores | Raw query finds no data |

---

## Phase 5: TEST & TREAT — Verify Hypotheses

### 5.1 Test Each Hypothesis

For each hypothesis, design a minimal test:

| Test Type | When to Use | Example |
|-----------|-------------|---------|
| **curl/API test** | API returns wrong data | `curl -H "Authorization: Bearer <token>" http://localhost:4000/api/v1/documents` |
| **Console.log** | Data flow unclear | Add temporary log at suspect point, reproduce, check output |
| **Breakpoint** | Complex logic | VS Code debugger on the suspect function |
| **Unit test** | Isolated logic bug | Write a minimal test reproducing the exact failure |
| **Network tab** | Request/response mismatch | Browser DevTools → Network → XHR filter |
| **Database query** | Data state unclear | Direct MongoDB query to verify document/user state |
| **Git bisect** | Regression timing | `git log --oneline -20` → check suspect commits |

### 5.2 Document Findings

As each test runs, record:
```
Test: <what was tested>
Result: <confirmed/refuted>
Finding: <what was learned>
Next: <what to test next, or proceed to fix>
```

### 5.3 Apply Fix

Once root cause is confirmed:

1. **Fix the root cause** — not the symptom
2. **No band-aids** — no optional chaining to mask `undefined`, no try-catch to swallow errors
3. **Single fix** — address one root cause, don't mix in refactoring
4. **Remove any temporary debug code** — console.logs, breakpoints, test endpoints

---

## Phase 6: BUILD VERIFICATION (Mandatory)

**After every fix, run the build to verify compilation and catch regressions.**

### 6.1 Run Build

Execute based on which workspace(s) were modified:

```bash
# If API was modified
yarn workspace @colbin/api build

# If frontend was modified
yarn workspace @colbin/web build

# If shared packages were modified
yarn build

# Always run typecheck on modified workspaces
yarn workspace @colbin/api tsc --noEmit
yarn workspace @colbin/web tsc --noEmit
```

### 6.2 Validate Imports (API only)

If API files were modified:
```bash
yarn workspace @colbin/api validate:imports
```

### 6.3 Verify Fix

- Reproduce the original issue — confirm it no longer occurs
- Check for regressions — verify related features still work
- Check for console.log / debug code left behind:

```bash
# Search for leftover debug code in changed files
git diff --name-only | xargs grep -n "console.log\|debugger\|TODO.*debug" 2>/dev/null
```

### 6.4 Build Failure Recovery

If the build fails after your fix:

| Build Error | Action |
|-------------|--------|
| TypeScript error in changed file | Fix the type error — your fix introduced it |
| TypeScript error in untouched file | Pre-existing — note it, don't fix in this scope |
| ESM import error | Run `yarn fix:imports` |
| Module resolution error | Check `tsconfig.json` paths, verify package exists |
| Circular dependency | Restructure the import chain |

---

## Phase 7: REPORT — Present Findings

### 7.1 Summary to User

Present a concise debug report:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEBUG COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Symptom:    <what was reported>
Root Cause: <confirmed cause>
Category:   <see categories below>
Fix:        <what was changed>

Files Modified:
- <file1>: <what changed>
- <file2>: <what changed>

Build:      PASS / FAIL
Verified:   <how the fix was confirmed>

Methodology: Google SRE hypothetico-deductive
Hypotheses tested: <N>
Signals checked: <list of layers examined>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /debug
File:  .claude/skills/debug/SKILL.md
```

### 7.2 Issue Categories

| Category | Description |
|----------|-------------|
| **API Error** | Controller/service/middleware throwing unexpected error |
| **Frontend Bug** | React rendering, state management, or data flow issue |
| **Data Issue** | Database record missing, malformed, or stale cache |
| **Auth Issue** | Token expired, permissions wrong, refresh flow broken |
| **Collaboration** | Y.js/Hocuspocus sync, CRDT state, awareness failure |
| **Performance** | Slow queries, N+1, excessive re-renders, memory leak |
| **Build Error** | TypeScript, ESM imports, circular dependencies |
| **Config Error** | Environment variables, feature flags, missing setup |
| **Race Condition** | Timing-dependent failure, concurrent modification |
| **Regression** | Working code broken by recent change |

---

## Observability Endpoints Reference

Quick-reference for all debugging endpoints and tools available in Colbin:

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/metrics/health` | GET | Service health (MongoDB, Redis, circuit breakers) |
| `/metrics/circuit-breakers` | GET | Circuit breaker states and failure counts |
| `/metrics` | GET | Prometheus metrics (request counts, latency) |

### Internal Monitoring

| System | Location | Access |
|--------|----------|--------|
| Winston Logger | `apps/api/src/config/logger.ts` | `LOGGING=verbose yarn dev:log` |
| Query Performance | `apps/api/src/utils/performanceMonitoring.ts` | Attached to `req.queryMetrics` |
| WS Security Monitor | `apps/api/src/utils/wsSecurityMonitor.ts` | `wsSecurityMonitor.getMetrics()` |
| Error Factory | `apps/api/src/utils/errors.util.ts` | Centralized error creation |
| Error Middleware | `apps/api/src/middlewares/error.ts` | Error conversion + handling |

### External Services

| Service | Purpose | Access |
|---------|---------|--------|
| Sentry | Error tracking | Org `o4507072911572992`, Project `4510866152161280` |
| Railway | API + Hocuspocus hosting | Dashboard logs |
| Vercel | Frontend hosting | Deployment logs |
| MongoDB | Primary database | Mongoose ODM / mongosh |
| Redis | Cache layer | Application / Redis CLI |

### Frontend Debugging

| Tool | Purpose |
|------|---------|
| Browser Console | JS errors, React warnings |
| Network Tab | API calls, WebSocket frames |
| React DevTools | Component tree, state, re-renders |
| Application Tab | localStorage (orgId, tokens) |
| Zustand DevTools | Store state inspection |

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Can't reproduce the issue | Ask user for exact steps, check if intermittent (race condition) |
| Issue is in production only | Switch to `/rca` skill for production investigation |
| Multiple root causes found | Fix the primary cause first, note secondary causes |
| Fix introduces new errors | Revert fix, re-analyze with new information |
| Build fails after fix | Treat build failure as Phase 3G, fix before reporting |
| Root cause is in a dependency | Document finding, check if upgrade available |

---

## Tips

### Maximize Efficiency
- Run Phase 2 health checks in PARALLEL — they're independent
- Check recent `git log` FIRST — most bugs are regressions
- Read the error message completely before forming hypotheses
- Don't guess — read the actual code at the failure point

### Avoid Common Pitfalls (Google SRE)
- **Recency bias**: Don't assume the bug is the same as last time
- **Correlation ≠ causation**: Two things happening together doesn't mean one caused the other
- **Occam's Razor**: Simpler explanations are more likely (typo > architecture flaw)
- **Don't brute force**: If one approach isn't working, step back and reconsider

### Debug Efficiently
- Use `LOGGING=verbose` for API issues — don't add manual console.logs first
- Use browser Network tab before adding frontend logging
- Check the health endpoints before diving into code
- Verify the database state before assuming the API is wrong
- Clean up ALL debug artifacts before finishing

---

## Self-Healing

**After every `/debug` execution**, run this phase to keep the skill accurate.

### Evaluate Skill Accuracy

Re-read this skill file and compare its instructions against what actually happened:

| Check | What to look for |
|-------|-----------------|
| **Endpoints** | Did health/metrics endpoints respond as documented? |
| **Build commands** | Did `yarn workspace` commands work with documented flags? |
| **File paths** | Are referenced files still at their documented locations? |
| **Error patterns** | Did error categories match the actual issue found? |
| **Gotchas list** | Should new gotchas be added based on this debug session? |
| **Monitoring tools** | Did any monitoring tools change or become unavailable? |

### Fix Issues Found

If any discrepancies were found:
1. Use the `Edit` tool to fix the specific inaccurate section in this skill file
2. Keep changes minimal and targeted
3. Log each fix:

```
Self-Healing Log:
- Fixed: <what was wrong> → <what it was changed to>
- Reason: <why the original was inaccurate>
```

If nothing needs fixing, skip silently.

### Append Attribution

**Output summary** displayed to the user:
```
Skill: /debug
File:  .claude/skills/debug/SKILL.md
Repo:  https://github.com/shekhardtu/colbin/blob/main/.claude/skills/debug/SKILL.md
```
