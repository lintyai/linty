---
name: rca
user-invocable: true
disable-model-invocation: false
description: Root Cause Analysis for production issues. Investigates data mismatches, blank pages, missing data, API errors, collaboration failures, auth issues using Sentry, Railway logs, Colbin MCP, and GitHub. Triggers on "investigate issue", "root cause", "debug production", "why is this broken", "blank page", "data mismatch", "collaboration broken", "websocket error", "document not loading".
---

# RCA — Root Cause Analysis

Systematic investigation of production issues using the full observability stack: Sentry, Railway application logs, Colbin MCP, and GitHub. Use this when a user reports a problem — blank documents, missing data, collaboration failures, slow pages, API errors, WebSocket disconnects, auth failures, etc.

## Core Concept: Trace Correlation

The investigation links events across multiple systems to reconstruct the full request lifecycle:

```
 Browser                Railway Logs           Sentry
    |                      |                    |
    | user action          |                    |
    +--- API call ---------+                    |
    |    (JWT token)       | (endpoint, userId, |
    |                      |  status, latency)  |
    |                      |        |           |
    |                      |        v           |
    |                      | Mongoose query log |
    |                      | (collection, query)|
    |                      |        |           |
    |                      |        +----------►| Error event
    |                      |                    | (if exception)
    |                      |                    |
    | WebSocket            |                    |
    +--- Y.js sync --------+-------------------►| Hocuspocus log
    |    (awareness,       | (documentName,     |
    |     CRDT updates)    |  connection state) |
```

**How it flows:**
1. Frontend actions trigger API calls with JWT auth tokens
2. API calls hit Express backend (Railway) with JWT auth token identifying the user
3. Express structured logs capture request details, user IDs, and response metadata
4. Sentry captures errors from both frontend (React) and backend (Express)
5. Hocuspocus WebSocket server logs collaboration events
6. MongoDB (via Mongoose) and Redis provide data state verification

## Input Required

Ask the user for (if not already provided):
1. **User email** — who experienced the issue
2. **Page/URL** — where the issue occurred (e.g., `/bin/:slug`, `/bins/:slug`, dashboard)
3. **Description** — what they saw (blank document, sync failure, error, slow load)
4. **Time window** — when it happened (default: last 24 hours)
5. **Screenshot** — if available, analyze it to understand what loaded vs what didn't

## Investigation Workflow

Execute steps IN ORDER. Run independent queries in PARALLEL where possible.

**IMPORTANT:** Before starting any investigation, create a Colbin knowledge document to track findings live. This is NOT optional.

---

### Step 0: Create Colbin RCA Document

Before investigating, create a Colbin knowledge document to track the full RCA lifecycle. This serves as a live investigation log and the final RCA report.

**Create the RCA document:**

Use Colbin MCP `colbin_create_document` tool:
- **Title:** `RCA: <short description>` (e.g., `RCA: Blank document for user after sharing`)
- **parentDocumentId:** `69a4171aab146a731a14e6f8`

**Content:** Initialize with the template below:

```markdown
# RCA: <short description>

**Date:** <today>
**Investigator:** [`/rca`](https://github.com/shekhardtu/colbin/blob/main/.claude/skills/rca/SKILL.md)
**Status:** Investigating

---

## 0. Observability Dashboard URLs

Visual confirmation links for every platform in this RCA. Click to verify findings directly.

### Sentry (Org ID: `o4507072911572992`)
| Dashboard | URL |
|-----------|-----|
| Issues | [Sentry Issues](https://sentry.io/issues/) |
| DSN Project | `4510866152161280` |

### Railway
| Dashboard | URL |
|-----------|-----|
| Project Dashboard | [Railway Dashboard](https://railway.app/dashboard) |
| API Service Logs | Check Railway project logs for Express API output |
| Hocuspocus Logs | Check Railway project logs for WebSocket server |

### GitHub
| Dashboard | URL |
|-----------|-----|
| Repository | [shekhardtu/colbin](https://github.com/shekhardtu/colbin) |
| Recent PRs | [Pull Requests](https://github.com/shekhardtu/colbin/pulls) |
| Actions | [GitHub Actions](https://github.com/shekhardtu/colbin/actions) |

### Vercel (Frontend)
| Dashboard | URL |
|-----------|-----|
| Project | [colbin-com](https://vercel.com/shekhardtu/colbin-com) |
| Deployments | Check latest deployments |

_Replace all `<placeholders>` with actual values during investigation._

---

## 1. Issue Report
| Field | Value |
|-------|-------|
| Affected user | <email> |
| Page/URL | <path> |
| Time reported | <timestamp> |
| Description | <what was observed> |

---

## 2. Investigation Log

_Findings are added here as each step completes. This is a live log._

### Sentry — Errors
_pending_

### Railway — API Logs
| Timestamp | Endpoint | User ID | Status | Latency | Notes |
|-----------|----------|---------|--------|---------|-------|
| _pending_ | | | | | |

### Railway — Hocuspocus/WebSocket Logs
_pending_

### Database State (MongoDB/Redis)
_pending_

### Vercel — Deployments
_pending_

### GitHub — Code Changes
_pending_

### Auth State (JWT/Refresh Tokens)
_pending_

---

## 3. Root Cause

**Category:** _pending_
**Root cause:** _pending_
**Evidence:** _pending_

---

## 4. Recommendation

_pending_

---

## 5. Timeline

| Time | Event |
|------|-------|
| <now> | RCA investigation started |
```

**After creating**, note the document URL and slug. As you complete EACH step below, update the document with findings using Colbin MCP `colbin_update_document_content`. This creates a real-time audit trail.

---

### Step 1: Check Sentry for Errors

Use Sentry MCP tools:
1. `search_issues` -- search for errors from the user's email or on the affected URL
2. `search_events` -- search for error events in the time window
3. If issues found, use `get_issue_details` or `analyze_issue_with_seer` for deep analysis

Sentry DSN info:
- **Org ID:** `o4507072911572992`
- **Project ID:** `4510866152161280`
- **Region:** `https://us.sentry.io`

Search for:
- Frontend React errors (component crashes, unhandled promise rejections)
- Backend Express API errors (500s, Mongoose errors, connection failures)
- WebSocket errors (Hocuspocus connection failures, Y.js sync errors)

**--> Update Colbin doc:** Fill in "Sentry -- Errors" with issue links or "No Sentry errors found".

---

### Step 2: Check Railway Application Logs

Railway hosts the Express API and Hocuspocus WebSocket server. Since Railway does not have a CLI equivalent to `gcloud logging read`, use these approaches:

#### 6.1 Check Express API Application Logs

The Express API uses structured logging. Key log patterns to look for:

- **Request/response logs** -- endpoint, userId, status code, latency
- **Mongoose query errors** -- failed database operations
- **Auth failures** -- invalid JWT, expired refresh token
- **Redis errors** -- cache connection issues
- **Hocuspocus events** -- WebSocket connection/disconnection

Use GitHub to check if the API has any logging middleware that captures request IDs:

```bash
# Search for logging patterns in the API
grep -r "Logger\|logger\|LoggerService" /Users/hari/2025/mp/colbin/apps/api/src/ --include="*.ts" -l
```

#### 6.2 Check Recent Error Patterns

If the issue is reproducible, check the Railway dashboard logs filtered by:
- Timestamp matching the user's reported issue time
- Error-level log entries (ERROR, WARN)
- The user's ID or email in log entries
- The affected endpoint path

#### 6.3 Check Hocuspocus/WebSocket Server Logs

For collaboration issues specifically:
- Connection events (connect, disconnect, close)
- Document sync errors
- Authentication failures on WebSocket upgrade
- Y.js merge conflicts or CRDT state corruption

**--> Update Colbin doc:** Fill in "Railway -- API Logs" and "Railway -- Hocuspocus/WebSocket Logs" sections.

---

### Step 3: Check Database State (MongoDB + Redis)

Verify the data layer is consistent. Use Mongoose queries or direct database inspection.

#### 7.1 MongoDB (via Mongoose)

Check the affected entity's state in the database:

```bash
# For document issues — check document exists and state
# Use MongoDB Compass or mongosh for direct inspection
mongosh "<MONGODB_URI>"
```

Key things to verify:
- **Document exists** and is not soft-deleted (`___status !== 'DELETED'`)
- **Document has correct appSource** (`appSource: 'editor'`)
- **User has access** -- check UserOrgMapping, document permissions
- **CRDT state** -- document has valid crdtState if collaboration issue
- **Share links** -- ShareLink records are valid and not expired
- **Session room** -- SessionRoom exists and links to the document

#### 7.2 Redis Cache

Check if stale cache is causing the issue:
- Cached document data might be outdated
- User session/token cached incorrectly
- Rate limiting might be blocking the user

**--> Update Colbin doc:** Fill in "Database State (MongoDB/Redis)" with findings.

---

### Step 4: Check Vercel Deployments (Frontend)

The frontend (`apps/editor`) is deployed to Vercel. Was there a recent deployment that could have caused the issue?

Use Vercel MCP tools:
1. `list_deployments` -- check recent deployments and their timestamps
2. `get_deployment` -- get details of a specific deployment
3. `get_deployment_build_logs` -- check for build warnings/errors
4. `get_runtime_logs` -- check for edge function errors

Key Vercel project:
| Project | App |
|---------|-----|
| `colbin-com` | Main editor app (`colbin.com` / `editor.colbin.com`) |

If a deploy happened close to the issue time, proceed to Step 5 to check what changed.

**--> Update Colbin doc:** Fill in "Vercel -- Deployments" with deployment timestamps and status.

---

### Step 5: Check GitHub for Recent Changes

If a deployment was identified near the issue time, or if the issue might be a regression, check what code was deployed:

```bash
# Check recent commits on main
git log --oneline --since="<issue_time_minus_2h>" --until="<issue_time>" --first-parent origin/main

# See what files changed in last N commits on main
git log --oneline --name-only -10 origin/main

# Check if a specific area was modified recently
git log --oneline --since="2 days ago" -- "apps/api/src/features/<affected_feature>/"
git log --oneline --since="2 days ago" -- "apps/editor/src/"

# Check the PR that was merged (via GitHub CLI)
gh pr list --state merged --base main --limit 10

# View a specific PR's changes
gh pr view <pr_number>
gh pr diff <pr_number>

# Diff between two commits to see exact changes
git diff <older_sha>..<newer_sha>
```

Also check:
- **GitHub Actions** -- any failed CI/CD runs: `gh run list --limit 10`
- **Blame** -- who last touched the affected file: `git blame <file_path>`

**--> Update Colbin doc:** Fill in "GitHub -- Code Changes" with commit SHAs, PR links, and relevant changes.

---

### Step 6: Check Auth State (JWT + Refresh Tokens)

Colbin uses JWT access tokens (15-minute expiry) and database-stored refresh tokens (7-day expiry) with rotation. There is NO Firebase Auth.

If the issue might be auth-related (401 errors, empty data, permission denied):

#### 10.1 Check User Account

Query the MongoDB database for the user:
- Account exists and is active (not disabled/deleted)
- User belongs to the correct organization (UserOrgMapping)
- User has appropriate role (Owner, Admin, Member)

#### 10.2 Check Refresh Token State

- Is the refresh token expired (older than 7 days)?
- Has the refresh token been rotated (used and invalidated)?
- Is the user's session still valid in the database?

#### 10.3 Signs of Auth Issues
- User's access token expired and refresh failed silently
- User was removed from organization but frontend cached old state
- JWT secret rotation invalidated all existing tokens
- API returning 200 with empty/restricted data due to permission check failure

**--> Update Colbin doc:** Fill in "Auth State (JWT/Refresh Tokens)" with findings or "Auth verified -- no issues".

---

### Step 7: Check Frontend Code (if needed)

If the API returned valid data but the UI still showed wrong output:
1. Find the page component that renders the affected area
2. Trace the data flow: API response -> Zustand store -> React component
3. Look for missing empty-state handling, data transformation bugs, or rendering conditions

Key frontend areas:
- `apps/editor/src/pages/` -- route-based pages
- `apps/editor/src/store/` -- Zustand state management
- `apps/editor/src/contexts/` -- WebSocket, Y.js, Activity contexts
- `apps/editor/src/services/` -- API service layer
- `packages/block-editor/` -- ProseMirror editor core
- `packages/websocket/` -- WebSocket connection management

**--> Update Colbin doc:** Add code file paths, data flow notes, and any rendering bugs found.

---

### Step 8: Finalize RCA Report

**A) Present summary to user:**

| Section | Content |
|---------|---------|
| **User** | Email, affected page |
| **What they saw** | Description + screenshot analysis |
| **API calls** | Endpoints, status codes, latency |
| **Database state** | Document state, user permissions, cache status |
| **Deployment** | Recent deploys near issue time, what changed (Vercel + Railway + GitHub) |
| **Auth status** | JWT/refresh token state |
| **Collaboration** | Hocuspocus/Y.js connection state if relevant |
| **Errors** | Sentry issues, Railway error logs |
| **Root cause** | Clear explanation of WHY the issue occurred |
| **Category** | See categories below |
| **Recommendation** | Fix, workaround, or follow-up action |
| **Dashboard URLs** | Links to every observability platform used (see Section 0 template) |

**B) Finalize the Colbin RCA document:**

Use Colbin MCP `colbin_update_document_content` to fill in:
1. **Section 0 (Dashboard URLs)** -- Replace all placeholders with actual URLs
2. **Section 3 (Root Cause)** -- category, root cause explanation, evidence
3. **Section 4 (Recommendation)** -- fix, workaround, or follow-up action
4. **Section 5 (Timeline)** -- add final entry: `RCA completed -- <category>: <one-line root cause>`
5. Change **Status** from `Investigating` to `Completed`

**C) Create GitHub issue (if bug found):**

```bash
gh issue create --title "[RCA] <short description>" --body "<summary with links to Colbin doc>"
```

## Issue Categories

| Category | Description | Example |
|----------|-------------|---------|
| **Data Gap** | API returned 200 but empty/missing data | Empty document, missing CRDT state, no content after share |
| **API Error** | Non-200 status, timeout, or exception | Express 500, Mongoose query failure, connection pool exhausted |
| **Frontend Bug** | Data received correctly but rendered wrong | React rendering issue, Zustand state stale, empty state not handled |
| **Collaboration Issue** | Hocuspocus/Y.js problems | WebSocket disconnect, Y.js merge conflict, CRDT state corruption, awareness sync failure |
| **Auth Issue** | Token expired, permission denied | Expired JWT, invalid refresh token, user removed from org |
| **Deploy Regression** | Recent deployment introduced the bug | Railway or Vercel deploy broke existing functionality |
| **Database Issue** | Schema or data inconsistency | MongoDB connection pool, schema mismatch, orphaned records |
| **Cache Issue** | Redis cache stale or corrupted | Stale document cache, Buffer/base64 encoding mismatch, cache invalidation failure |
| **User Config** | User's action caused expected behavior | No documents in collection, permission correctly restricted |
| **Infra Issue** | Service degradation, resource limits | Railway scaling, MongoDB connection limits, Redis memory |

## Key Reference

### Tools & What They Provide

| Tool | Use For | MCP Available |
|------|---------|---------------|
| **Sentry** | JavaScript errors, unhandled exceptions, stack traces, AI analysis (Seer) | Yes |
| **Colbin MCP** | Create/update RCA knowledge documents, search existing documents | Yes |
| **Vercel** | Frontend deployment history, build logs, runtime logs | Yes |
| **Cloudflare DNS** | DNS record verification, domain resolution | Yes |
| **GitHub** | Deployed code changes, PR diffs, CI/CD status, commit history | Via `gh` CLI |
| **Railway Logs** | Express backend logs, Hocuspocus WebSocket logs | Via Railway dashboard |
| **MongoDB** | Database state verification, user/document/permission records | Via mongosh or MongoDB Compass |
| **Redis** | Cache state verification, session data | Via application or Redis CLI |
| **Frontend Code** | Data flow, rendering logic, empty state handling | Via file read |

### Infrastructure Reference

| Resource | Value |
|----------|-------|
| **Deployment Platform** | Railway (API + Hocuspocus) + Vercel (Frontend) |
| **Database** | MongoDB on Railway (Mongoose ODM) |
| **Cache** | Redis on Railway |
| **Real-time** | Hocuspocus Y.js WebSocket server (Railway) |
| **Auth** | JWT access tokens (15m) + DB refresh tokens (7d) with rotation |
| **Frontend Framework** | React 19 + Vite 6 + Tailwind + shadcn/ui + Zustand |
| **Backend Framework** | Node.js + Express + TSOA + Mongoose |
| **Editor** | ProseMirror block editor + Monaco code editor |
| **Collaboration** | Y.js CRDT via Hocuspocus |
| **Sentry DSN Org** | `o4507072911572992` |
| **Sentry Project ID** | `4510866152161280` |
| **Production URL** | `colbin.com` / `editor.colbin.com` |
| **API URL** | `api.colbin.com` |
| **GitHub Repo** | `shekhardtu/colbin` |
| **Vercel Project** | `colbin-com` |
| **Monorepo Tool** | Yarn workspaces + Turborepo |

### Project Structure

| Path | Purpose |
|------|---------|
| `apps/api/` | Express backend (REST API + Hocuspocus) |
| `apps/editor/` | React frontend (Vite + Tailwind + shadcn/ui) |
| `packages/block-editor/` | ProseMirror block editor core |
| `packages/magic-input/` | Input transformation engine |
| `packages/shared-utils/` | Shared utility functions |
| `packages/websocket/` | WebSocket connection management |
| `packages/hagen-client/` | Generated API TypeScript client |
| `packages/storage/` | Storage abstraction |
| `packages/retry/` | Retry logic utilities |
| `packages/canvas-editor/` | Canvas-based editor |

### Demo Credentials (from seed)

| Email | Password | Role |
|-------|----------|------|
| alice@demo.com | DemoPass123 | Owner |
| bob@demo.com | DemoPass123 | Admin |
| carol@demo.com | DemoPass123 | Not yet in org |
| **Organization:** Demo Team (`demo-team`) | | |

## Tips

### Maximize Parallelism
- Steps 1, 2, 4 can ALL run in parallel -- they query different systems
- Run Vercel deployment check in parallel with database state checks
- Run GitHub code check in parallel with auth state verification

### Railway Logs
- Express API uses structured logging -- look for JSON-formatted log entries
- Hocuspocus logs WebSocket connection events with document names
- Filter by timestamp and error level for efficient investigation
- Check both API service and WebSocket service logs separately

### Database (MongoDB + Redis)
- Use MongoDB Compass or mongosh for quick database inspection
- Check `appSource: 'editor'` filter -- missing this returns cross-app data
- For CRDT issues, check if `crdtState` field is null or corrupted
- Redis cache uses base64 encoding for binary fields -- check for encoding mismatches

### Vercel + GitHub
- Check deployments FIRST if the issue started suddenly for multiple users
- Use `gh pr diff` to see exactly what code changed in a suspicious deployment
- Compare the deployment timestamp with the issue report timestamp
- Check both Vercel (frontend) AND Railway (backend) deploys -- they're independent

### Auth-Specific
- JWT access tokens expire every 15 minutes -- check if frontend refresh flow works
- Refresh tokens are stored in MongoDB and rotated on use
- Check UserOrgMapping table for permission issues
- No Firebase -- all auth is JWT-based with database-stored sessions

### Collaboration-Specific
- Hocuspocus manages Y.js document state server-side
- Check if the WebSocket connection was established (upgrade successful)
- Y.js awareness protocol handles cursor positions and user presence
- CRDT state corruption can cause "blank document" even when data exists in DB
- Check `packages/websocket/` for shared WebSocket connection management

### General
- When the user provides a screenshot, analyze what DID load vs what DIDN'T to narrow investigation
- For multi-document collections (`/bins/:slug`), verify SessionRoom -> Document relationships

---

## Self-Healing

**After every `/rca` execution**, run this phase to keep the skill accurate and discoverable.

### Evaluate Skill Accuracy

Re-read this skill file (`Read` tool on `.claude/skills/rca/SKILL.md`) and compare its instructions against what actually happened during this execution:

| Check | What to look for |
|-------|-----------------|
| **MCP tool names** | Did any `colbin_*`, `mcp__sentry__*`, or `mcp__vercel__*` calls fail? |
| **Railway logs** | Were Railway logs accessible as documented? Did the logging format change? |
| **Infrastructure** | Did Sentry org/project IDs, domain names, Vercel project names, or Railway config change? |
| **Auth flow** | Did the JWT/refresh token flow work as documented? Any changes to token expiry or rotation? |
| **Database** | Did Mongoose schemas or collection names change? Are the documented collections still accurate? |
| **New tools** | Were any new observability tools or MCP servers used that aren't documented here? |

### Fix Issues Found

If any discrepancies were found:
1. Use the `Edit` tool to fix the specific inaccurate section in this skill file
2. Update the Infrastructure Reference table if values changed
3. Update HogQL queries if column/table names changed
4. Keep changes minimal and targeted
5. Log each fix:

   ```
   Self-Healing Log:
   - Fixed: <what was wrong> -> <what it was changed to>
   - Reason: <why the original was inaccurate>
   ```

If nothing needs fixing, skip silently.

### Append Trigger Documentation

After execution, append a skill attribution footer to:

**Colbin RCA document** (add to the finalized document in Step 13):
```markdown
---
*Investigated by [`/rca`](https://github.com/shekhardtu/colbin/blob/main/.claude/skills/rca/SKILL.md) -- Triggers: "investigate issue", "root cause", "debug production", "why is this broken", "blank page", "data mismatch", "collaboration broken", "websocket error", "document not loading"*
```

**Output summary** displayed to the user:
```
Skill: /rca
File:  .claude/skills/rca/SKILL.md
Repo:  https://github.com/shekhardtu/colbin/blob/main/.claude/skills/rca/SKILL.md
```
