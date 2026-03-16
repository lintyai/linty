---
name: evaluate
user-invocable: true
disable-model-invocation: false
description: Evaluate major changes before committing to them. Researches external docs/blogs/papers, analyzes codebase blast radius, identifies risks and scary areas, defines metrics and test strategy, produces a go/no-go recommendation, and optionally chains into /build. Triggers on "evaluate this", "should we migrate", "should I implement", "is this worth it", "evaluate migration", "evaluate change", "/evaluate".
---

# Evaluate — Major Change Decision Framework

Comprehensive evaluation of major technical decisions: migrations, architectural changes, technology swaps, large refactors, or risky feature additions. Produces an evidence-based **go/no-go recommendation** with full risk analysis, blast radius mapping, metrics plan, and test strategy.

Use this BEFORE committing engineering effort to a major change. The output is an evaluation document — not code.

## When to Use

Run `/evaluate` when considering:
- **Database migrations** (MongoDB → Postgres, MySQL → DynamoDB)
- **Framework swaps** (Express → Fastify, React → Solid)
- **Architecture changes** (monolith → microservices, REST → GraphQL)
- **Major dependency upgrades** (Node 18 → 22, React 18 → 19)
- **Infrastructure changes** (Railway → AWS, Vercel → Cloudflare)
- **Large refactors** (rewrite auth, overhaul state management)
- **New technology adoption** (add Redis, add Kafka, add WebSockets)
- **Any change where the wrong decision is expensive to reverse**

**Do NOT use for**: small features, bug fixes, minor refactors, or changes with obvious low risk. Use `/build` directly for those.

---

## Phase 1: INTAKE

Understand exactly what is being proposed and why.

### 1.1 Parse the Proposal

From the user's prompt, identify:
- **What**: The specific change being proposed (e.g., "Migrate MongoDB to Postgres")
- **Why**: The motivation — what problem does this solve?
- **Scope**: Which systems/apps/packages are affected
- **Constraints**: Timeline pressure, budget, team size, backwards compatibility needs

### 1.2 Clarify with User

Use `AskUserQuestion` to gather missing context:

**Question 1: Motivation**
- Performance issues with current solution
- Scalability concerns
- Developer experience / maintainability
- Cost reduction
- New feature requirements that current stack can't support
- Industry best practice / future-proofing

**Question 2: Constraints**
- Can we do this incrementally (dual-write, feature flags)?
- Is there a hard deadline?
- Is downtime acceptable during migration?
- Must we maintain backwards compatibility?

**Question 3: Success Criteria**
Ask the user: "What does success look like? What specific outcome would make this change worth the effort?"

### 1.3 Define Evaluation Scope

Based on answers, define what the evaluation will cover:
- Which areas of the codebase are in scope
- Which external systems interact with the affected areas
- Whether this is a one-shot change or incremental migration

---

## Phase 2: EXTERNAL RESEARCH

Research the proposed change using external sources. **This is the most critical phase — decisions must be evidence-based, not opinion-based.**

### 2.1 Official Documentation

Use `WebSearch` and `WebFetch` to research:
- **Migration guides**: Official docs for migrating FROM current → TO proposed technology
- **Breaking changes**: What APIs/behaviors change between current and proposed
- **Feature parity**: Does the proposed technology support everything we currently use?
- **Known limitations**: What can't the proposed technology do?

### 2.2 Community Experience

Search for real-world experiences:
```
WebSearch queries (adapt to the specific change):
- "<current> to <proposed> migration experience"
- "<proposed technology> production issues"
- "<proposed technology> at scale problems"
- "<current> vs <proposed> 2025 comparison"
- "<proposed technology> gotchas pitfalls"
- "<proposed technology> post-mortem"
```

Look for:
- **Blog posts** from teams who've done this migration
- **Post-mortems** from failed migrations
- **Conference talks** on the topic
- **GitHub issues** in the proposed technology's repo (open issues, common complaints)
- **Stack Overflow** common problems

### 2.3 Benchmarks & Data

Search for quantitative comparisons:
- Performance benchmarks (latency, throughput, memory)
- Cost comparisons (hosting, licensing, operational overhead)
- Ecosystem health (npm downloads, GitHub stars, release frequency, maintainer activity)
- Adoption trends (is this technology growing or declining?)

### 2.4 Research Summary

Compile all findings into a structured format:

| Source | Key Finding | Relevance |
|--------|------------|-----------|
| Official docs | <finding> | <how it affects us> |
| Blog: <title> | <finding> | <how it affects us> |
| Benchmark: <source> | <finding> | <how it affects us> |
| GitHub issue #N | <finding> | <how it affects us> |

---

## Phase 3: CODEBASE IMPACT ANALYSIS

Map exactly what in OUR codebase would be affected.

### 3.1 Dependency Mapping

Use `Grep`, `Glob`, and `Read` to find every touchpoint:

```
For a database migration example:
- All Mongoose model definitions
- All database queries (find, aggregate, update, delete)
- All schema definitions and indexes
- All migration/seed scripts
- All test files that touch the database
- Configuration files (connection strings, pool settings)
- Services that directly query the database
- Middleware that depends on database features (transactions, change streams)
```

### 3.2 Blast Radius Assessment

Categorize every affected file by impact level:

| Impact Level | Definition | Example |
|-------------|------------|---------|
| **CRITICAL** | Must change or app won't start | Database connection, schema definitions |
| **HIGH** | Must change or feature is broken | Query logic, data access layer |
| **MEDIUM** | Should change but can work temporarily | Performance optimizations, caching |
| **LOW** | Nice to change but not required | Logging, monitoring, dev tooling |
| **NONE** | Not affected | UI components, unrelated services |

### 3.3 Feature Parity Check

For each feature we currently use from the existing technology, verify:

| Feature We Use | Current Implementation | Proposed Equivalent | Gap? |
|---------------|----------------------|-------------------|------|
| <feature 1> | <how we use it> | <equivalent or N/A> | Yes/No |
| <feature 2> | <how we use it> | <equivalent or N/A> | Yes/No |

**IMPORTANT**: Features marked "Gap: Yes" are blockers or require workarounds. These are the scary areas.

### 3.4 Scary Areas

Identify the highest-risk parts of the migration:
- Areas with complex business logic tightly coupled to the current technology
- Areas with no test coverage (changes here are blind)
- Areas that handle money, permissions, or user data
- Areas with implicit dependencies (things that work "by accident")
- Third-party integrations that depend on the current technology's data format

Present these to the user with `AskUserQuestion`:
- **"I've identified these high-risk areas. Are there others I should know about?"**
  - Show the list of scary areas
  - Options: "Looks complete" / "I have additions"

---

## Phase 4: RISK ASSESSMENT

### 4.1 Risk Matrix

Categorize all identified risks:

| ID | Risk | Likelihood | Impact | Severity | Mitigation |
|----|------|-----------|--------|----------|------------|
| R1 | <description> | Low/Med/High | Low/Med/High | <L×I score> | <mitigation strategy> |
| R2 | <description> | Low/Med/High | Low/Med/High | <L×I score> | <mitigation strategy> |

**Severity scoring:**
- **Critical** (High × High): Could cause data loss, extended downtime, or security breach
- **High** (High × Med or Med × High): Could cause significant feature degradation
- **Medium** (Med × Med): Could cause temporary issues with known workarounds
- **Low** (Low × anything or anything × Low): Minor inconvenience

### 4.2 Risk Categories

Evaluate risks across these dimensions:

| Category | What to Assess |
|----------|---------------|
| **Data Integrity** | Can we migrate data without loss? Are there format incompatibilities? |
| **Performance** | Will the new solution be faster/slower? Under what conditions? |
| **Availability** | How much downtime does the migration require? Can we do it live? |
| **Security** | Does the change introduce new attack vectors? Do we lose security features? |
| **Developer Experience** | Learning curve? Tooling quality? Debugging difficulty? |
| **Operational** | Monitoring, alerting, backup, disaster recovery — do we lose any? |
| **Rollback** | Can we reverse this? How quickly? What data do we lose if we roll back? |
| **Cost** | Hosting, licensing, engineering time, opportunity cost |
| **Ecosystem** | Library support, community size, long-term maintenance |

### 4.3 Reversibility Assessment

**This is the most important risk factor.** Classify the change:

| Reversibility | Description | Example |
|--------------|-------------|---------|
| **Easily Reversible** | Can undo in hours, no data loss | Feature flag toggle, config change |
| **Reversible with Effort** | Can undo in days, requires engineering work | Library swap with adapter pattern |
| **Partially Reversible** | Can undo most things, some changes are permanent | Database migration (data format changes) |
| **Irreversible** | Cannot practically undo | Data deletion, external API contract changes |

---

## Phase 5: MIGRATION STRATEGY

### 5.1 Approach Options

Present 2-3 migration strategies (where applicable):

**Option A: Big Bang**
- Stop the world, migrate everything at once
- Pros: Simple, no dual-write complexity
- Cons: High risk, requires downtime, all-or-nothing

**Option B: Strangler Fig (Incremental)**
- Gradually migrate service by service / feature by feature
- Dual-write during transition, feature flags to switch
- Pros: Lower risk, can stop and assess, no downtime
- Cons: Longer timeline, dual-write complexity, temporary tech debt

**Option C: Parallel Run**
- Run both systems simultaneously, compare results
- Gradually shift traffic to new system
- Pros: Validates correctness before full cutover
- Cons: 2x infrastructure cost during transition

Use `AskUserQuestion` to ask the user which approach they prefer:
- Present pros/cons of each
- Options: "Option A: Big Bang" / "Option B: Incremental" / "Option C: Parallel Run"

### 5.2 Phase Breakdown

For the chosen approach, define migration phases:

| Phase | Scope | Duration Estimate | Rollback Plan |
|-------|-------|-------------------|---------------|
| 1 | <what gets migrated first> | <relative size> | <how to roll back> |
| 2 | <next batch> | <relative size> | <how to roll back> |
| N | <final batch + cleanup> | <relative size> | <how to roll back> |

---

## Phase 6: METRICS & OBSERVABILITY

### 6.1 Before Migration (Baseline)

Define metrics to capture BEFORE making any changes:

| Metric | How to Measure | Current Baseline |
|--------|---------------|-----------------|
| API response time (p50, p95, p99) | Application monitoring | <measure or "TBD"> |
| Error rate | Sentry / application logs | <measure or "TBD"> |
| Database query latency | Query logs / APM | <measure or "TBD"> |
| Memory / CPU usage | Infrastructure monitoring | <measure or "TBD"> |
| Deployment frequency | Git history / CI | <measure or "TBD"> |
| <domain-specific metric> | <measurement method> | <measure or "TBD"> |

### 6.2 During Migration

Define what to monitor during the migration:

| Signal | Threshold | Action if Breached |
|--------|-----------|-------------------|
| Error rate | > 2x baseline | Pause migration, investigate |
| Response time p95 | > 2x baseline | Investigate, consider rollback |
| Data mismatch rate | > 0.1% | Stop dual-write, fix mismatch |
| <custom signal> | <threshold> | <action> |

### 6.3 After Migration (Convergence)

Define success criteria — the migration is "done" when:

| Metric | Target | Measurement Period |
|--------|--------|-------------------|
| Error rate | ≤ baseline | 7 days post-migration |
| Response time | ≤ 110% of baseline | 7 days post-migration |
| Data integrity | 100% match | Full audit post-migration |
| Feature parity | All features working | Manual verification checklist |
| <custom metric> | <target> | <period> |

---

## Phase 7: TEST STRATEGY

### 7.1 Automated Tests

| Test Type | What to Test | Priority | Exists? |
|-----------|-------------|----------|---------|
| Unit tests | Data access layer with new technology | P1 | Yes/No |
| Integration tests | API endpoints with new backend | P1 | Yes/No |
| Migration tests | Data migration script correctness | P1 | No (new) |
| Performance tests | Query latency comparison | P2 | Yes/No |
| E2E tests | Critical user flows end-to-end | P1 | Yes/No |
| Rollback tests | Verify rollback procedure works | P1 | No (new) |

### 7.2 Manual Test Cases

| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MT1 | <scenario> | <steps> | <expected> | P1/P2/P3 |
| MT2 | <scenario> | <steps> | <expected> | P1/P2/P3 |

Focus manual tests on:
- Edge cases that are hard to automate
- User-facing workflows that must not break
- Data migration correctness for edge-case records
- Rollback procedure verification
- Performance under realistic load

### 7.3 Canary / Shadow Testing

Define how to validate in production before full rollout:
- Shadow testing: Run new system in parallel, compare outputs
- Canary deployment: Route small % of traffic to new system
- Feature flags: Enable for internal users first, then gradually roll out

---

## Phase 8: COLBIN EVALUATION DOCUMENT

Create a comprehensive evaluation document using `colbin_create_document`.

### Document Fields

```
title: "Evaluate: <short description>" (e.g., "Evaluate: MongoDB to PostgreSQL Migration")
type: "document" (Markdown)
parentDocumentId: "69a4171aab146a731a14e6f8"
```

### Document Content Template

````markdown
# Evaluate: <Short Description>

> **Status**: Evaluation Complete | **Date**: <today> | **Verdict**: <PENDING>

## 1. Proposal

### What
<The specific change being proposed>

### Why
<The motivation — what problem does this solve?>

### Success Criteria
<What does success look like from the user's perspective?>

### Constraints
<Timeline, budget, team size, backwards compatibility needs>

---

## 2. External Research

### Official Documentation
<Key findings from official docs, migration guides, feature parity>

### Community Experience
| Source | Key Finding | Relevance to Us |
|--------|------------|-----------------|
| <source> | <finding> | <relevance> |

### Benchmarks & Data
| Metric | Current (<technology>) | Proposed (<technology>) | Source |
|--------|----------------------|------------------------|--------|
| <metric> | <value> | <value> | <source> |

### Research Verdict
<1-2 sentence summary: Does external evidence support this change?>

---

## 3. Blast Radius

### Affected Files
| Impact | Count | Key Files |
|--------|-------|-----------|
| CRITICAL | <N> | <list> |
| HIGH | <N> | <list> |
| MEDIUM | <N> | <list> |
| LOW | <N> | <list> |

**Total files affected**: <N>

### Feature Parity
| Feature We Use | Equivalent in Proposed? | Gap? |
|---------------|------------------------|------|
| <feature> | <yes/no/partial> | <description if gap> |

### Scary Areas
<List of highest-risk areas with explanation of why they're scary>

---

## 4. Risk Assessment

### Risk Matrix
| ID | Risk | Likelihood | Impact | Severity | Mitigation |
|----|------|-----------|--------|----------|------------|
| R1 | <risk> | <L/M/H> | <L/M/H> | <severity> | <mitigation> |

### Reversibility
**Classification**: <Easily Reversible / Reversible with Effort / Partially Reversible / Irreversible>
**Rollback plan**: <description>
**Estimated rollback time**: <duration>

### Risk Summary
- **Critical risks**: <count> — <summary>
- **High risks**: <count> — <summary>
- **Mitigatable risks**: <count>
- **Accepted risks**: <count>

---

## 5. Migration Strategy

### Recommended Approach
**<Big Bang / Incremental / Parallel Run>**
<Rationale for chosen approach>

### Phase Breakdown
| Phase | Scope | Rollback Plan |
|-------|-------|---------------|
| 1 | <scope> | <rollback> |
| 2 | <scope> | <rollback> |

---

## 6. Metrics & Observability

### Baseline (Before)
| Metric | Current Value |
|--------|--------------|
| <metric> | <value or TBD> |

### During Migration
| Signal | Threshold | Action if Breached |
|--------|-----------|-------------------|
| <signal> | <threshold> | <action> |

### Convergence (After)
| Metric | Target | Measurement Period |
|--------|--------|-------------------|
| <metric> | <target> | <period> |

---

## 7. Test Strategy

### Automated Tests
| Type | What | Priority | New? |
|------|------|----------|------|
| <type> | <what> | P1/P2 | Yes/No |

### Manual Test Cases
| ID | Scenario | Priority |
|----|----------|----------|
| MT1 | <scenario> | P1/P2/P3 |

### Canary Plan
<How to validate in production before full rollout>

---

## 8. Verdict

### Recommendation: <GO / NO-GO / CONDITIONAL GO>

### Reasoning
<3-5 bullet points explaining the recommendation>

### If GO:
- **Estimated effort**: <size>
- **Recommended approach**: <approach>
- **First step**: <what to do first>
- **Critical prerequisites**: <what must be true before starting>

### If NO-GO:
- **Primary blockers**: <what makes this inadvisable>
- **Alternative approaches**: <what to do instead>
- **Revisit conditions**: <under what conditions should we reconsider>

### If CONDITIONAL GO:
- **Conditions that must be met**: <list>
- **Reduced scope recommendation**: <what to do if full scope is too risky>

---

## 9. References
- <Link to official docs>
- <Link to relevant blog posts>
- <Link to benchmarks>
- <Link to codebase files>

---
*Evaluated by [`/evaluate`](https://github.com/shekhardtu/colbin/blob/main/.claude/skills/evaluate/SKILL.md)*
````

**IMPORTANT**: Store the document `url` and `slug` from the response — they're needed for the verdict phase.

---

## Phase 9: HUMAN VERIFICATION (Gate)

**This is the mandatory decision gate. The entire point of the skill.**

### 9.1 Present Summary

Display the evaluation summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EVALUATION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Document:    [Title](colbin-doc-url)
Proposal:    <1-line summary>
Verdict:     <GO / NO-GO / CONDITIONAL GO>

Blast Radius:
  CRITICAL:  <N> files
  HIGH:      <N> files
  MEDIUM:    <N> files
  Total:     <N> files affected

Risks:
  Critical:  <N> risks
  High:      <N> risks
  Mitigated: <N> risks

Feature Gaps: <N> gaps found
Reversibility: <classification>

Key Findings:
  + <pro 1>
  + <pro 2>
  - <con 1>
  - <con 2>
  ! <warning 1>

Recommended Approach: <approach>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 9.2 Get Decision

Use `AskUserQuestion`:

**"Based on this evaluation, how would you like to proceed?"**
- **"Go — start building"** → Chain into `/build` with the evaluation context
- **"Go — but I want to modify the scope first"** → Gather modifications, update doc
- **"No-go — not worth it"** → Close evaluation, document the decision
- **"I need more information on specific areas"** → Ask what areas, do targeted research

### 9.3 Handle Each Decision

**If "Go — start building":**
1. Update the Colbin evaluation document: change Verdict to **GO**, Status to **Approved**
2. Invoke the `/build` skill with the evaluation context
3. Pass the evaluation document URL to `/build` so it links back

**If "Go — modify scope":**
1. Gather the user's modifications via `AskUserQuestion`
2. Update the evaluation document with revised scope
3. Re-assess affected sections (blast radius, risks, metrics)
4. Re-present the summary (loop back to 9.1)

**If "No-go":**
1. Update the Colbin evaluation document: change Verdict to **NO-GO**, Status to **Declined**
2. Document the reasoning for future reference
3. Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EVALUATION: NO-GO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Decision documented: [Title](colbin-doc-url)

Alternative approaches suggested in the document.
This evaluation can be revisited when conditions change.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /evaluate
File:  .claude/skills/evaluate/SKILL.md
```

**If "Need more information":**
1. Ask what specific areas need deeper investigation
2. Run targeted research (web search, codebase analysis, or both)
3. Update the evaluation document with new findings
4. Re-present the summary (loop back to 9.1)

---

## Phase 10: SELF-HEALING

**After every `/evaluate` execution**, run this phase to keep the skill accurate.

### 10.1 Evaluate Skill Accuracy

Re-read this skill file and compare its instructions against what actually happened during execution:

| Check | What to look for |
|-------|-----------------|
| **MCP tool names** | Did any `colbin_*` MCP calls fail because the tool name, parameter name, or syntax changed? |
| **Web search** | Did `WebSearch` or `WebFetch` queries return useful results? Should query templates be updated? |
| **Codebase analysis** | Were the Grep/Glob patterns effective? Any new patterns needed? |
| **Workflow logic** | Did any phase need to be skipped, reordered, or modified? |
| **Templates** | Are document templates and evaluation frameworks still accurate? |
| **User interaction** | Were the AskUserQuestion prompts clear and useful? |

### 10.2 Fix Issues Found

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

## Error Handling

| Scenario | Action |
|----------|--------|
| Colbin MCP fails | Retry once, then present evaluation in console without doc |
| Web search returns no results | Note the gap, rely on codebase analysis and user knowledge |
| User provides vague proposal | Ask targeted clarifying questions before proceeding |
| Evaluation reveals the change is trivial | Inform user, suggest skipping evaluation and going straight to `/build` |
| User wants to evaluate multiple options | Run Phases 2-4 for each option, create comparison table in document |
| Research contradicts user's assumption | Present evidence neutrally, let user decide |

---

## State Tracking

Throughout the entire workflow, maintain awareness of:
- **Colbin document URL and slug**
- **Current phase** (which phase we're in)
- **Research findings** (running list of all sources consulted)
- **Risk count by severity** (updated as new risks are discovered)
- **User decisions** (all AskUserQuestion responses)

---

## Tips

- **Be neutral**: Present evidence, not opinions. Let the data drive the recommendation.
- **Quantify when possible**: "23 files affected" is better than "many files affected"
- **Show your work**: Link to sources, cite specific files, reference concrete data
- **Don't scare unnecessarily**: Every migration has risks — frame them with mitigations
- **Don't downplay real risks**: If something is genuinely dangerous, say so clearly
- **Compare to alternatives**: "Don't do it" is incomplete — suggest what to do instead
- **Think about the team**: Developer experience and learning curve matter
- **Consider timing**: Is now the right time, even if the change itself is good?
- **Blast radius over everything**: The size of what could go wrong matters more than the probability
