---
name: evaluate
user-invocable: true
disable-model-invocation: false
description: Evaluate major changes before committing to them. Researches external docs/blogs, analyzes codebase blast radius, identifies risks and scary areas, defines metrics and test strategy, produces a go/no-go recommendation, and optionally chains into /build. Triggers on "evaluate this", "should we migrate", "should I implement", "is this worth it", "evaluate change", "/evaluate".
---

# Evaluate — Major Change Decision Framework

Comprehensive evaluation of major technical decisions: migrations, architectural changes, technology swaps, large refactors, or risky feature additions. Produces an evidence-based **go/no-go recommendation** with full risk analysis, blast radius mapping, and test strategy.

Use this BEFORE committing engineering effort to a major change. The output is an evaluation — not code.

## When to Use

Run `/evaluate` when considering:
- **Framework/library swaps** (e.g., replacing whisper-rs with candle)
- **Architecture changes** (e.g., moving transcription to a sidecar process)
- **Major dependency upgrades** (Tauri v2 minor bumps, React major versions)
- **Platform changes** (adding Windows/Linux support, new macOS APIs)
- **Large refactors** (rewriting audio pipeline, overhauling state management)
- **New technology adoption** (adding a local LLM, new audio library)
- **Any change where the wrong decision is expensive to reverse**

**Do NOT use for**: small features, bug fixes, minor refactors. Use `/build` directly.

---

## Phase 1: INTAKE

### 1.1 Parse the Proposal

From the user's prompt, identify:
- **What**: The specific change being proposed
- **Why**: The motivation — what problem does this solve?
- **Scope**: Which layers are affected (frontend, Rust backend, macOS FFI, Tauri config)
- **Constraints**: Timeline, backwards compatibility, platform support

### 1.2 Clarify with User

Use `AskUserQuestion` to gather:

**Question 1: Motivation**
- Performance / latency issues
- New feature requirements current stack can't support
- Developer experience / maintainability
- Platform support (cross-platform needs)
- Industry best practice / future-proofing

**Question 2: Constraints**
- Can we do this incrementally?
- Is there a hard deadline?
- Must we maintain backwards compatibility?

**Question 3: Success Criteria**
"What does success look like?"

---

## Phase 2: EXTERNAL RESEARCH

### 2.1 Official Documentation

Use `WebSearch` and `WebFetch` for:
- Migration guides for the proposed technology
- Breaking changes between current and proposed
- Feature parity assessment
- Known limitations

### 2.2 Community Experience

```
WebSearch queries:
- "<current> to <proposed> migration experience"
- "<proposed technology> production issues"
- "<proposed technology> macOS desktop app"
- "<current> vs <proposed> 2025 comparison"
```

### 2.3 Benchmarks & Data

- Performance benchmarks (latency, throughput, memory)
- Ecosystem health (crates.io downloads, GitHub stars, release frequency)
- Adoption trends

---

## Phase 3: CODEBASE IMPACT ANALYSIS

### 3.1 Dependency Mapping

Use Grep, Glob, and Read to find every touchpoint in Linty:

```
Frontend (src/):
- Components, hooks, services that interact with the affected area
- Store slices that manage related state
- Tauri invoke() calls to affected commands

Backend (src-tauri/src/):
- Rust modules that import/use the affected crate
- Tauri commands that touch the affected area
- State structs that hold affected data
- FFI code that interacts with macOS APIs

Config:
- Cargo.toml dependencies and features
- tauri.conf.json permissions and capabilities
- Entitlements.plist if macOS permissions change
```

### 3.2 Blast Radius Assessment

| Impact Level | Definition |
|-------------|------------|
| **CRITICAL** | Must change or app won't start |
| **HIGH** | Must change or feature is broken |
| **MEDIUM** | Should change but can work temporarily |
| **LOW** | Nice to change but not required |

### 3.3 Feature Parity Check

| Feature We Use | Current Implementation | Proposed Equivalent | Gap? |
|---------------|----------------------|-------------------|------|
| <feature> | <how we use it> | <equivalent or N/A> | Yes/No |

### 3.4 Scary Areas

Identify highest-risk parts:
- Areas with macOS FFI tightly coupled to the current approach
- Audio pipeline (real-time, latency-sensitive)
- Areas with no test coverage
- Entitlements and TCC behavior (hard to test programmatically)

---

## Phase 4: RISK ASSESSMENT

### 4.1 Risk Matrix

| ID | Risk | Likelihood | Impact | Severity | Mitigation |
|----|------|-----------|--------|----------|------------|
| R1 | <desc> | Low/Med/High | Low/Med/High | <score> | <mitigation> |

### 4.2 Reversibility Assessment

| Reversibility | Description |
|--------------|-------------|
| **Easily Reversible** | Can undo in hours, no data loss |
| **Reversible with Effort** | Can undo in days, requires work |
| **Partially Reversible** | Can undo most things, some permanent |
| **Irreversible** | Cannot practically undo |

---

## Phase 5: MIGRATION STRATEGY

Present 2-3 approaches where applicable:

**Option A: Big Bang** — Change everything at once
**Option B: Incremental** — Gradually migrate behind feature flags
**Option C: Parallel Run** — Run both, compare results

---

## Phase 6: TEST STRATEGY

| Test Type | What to Test | Priority |
|-----------|-------------|----------|
| Manual | Fn key → record → transcribe → paste flow | P1 |
| Build | `yarn build` + `cargo check` pass | P1 |
| macOS | Test from Finder (not Terminal) for TCC | P1 |
| Performance | Audio latency, transcription speed | P2 |
| Release | `yarn build:mac` produces working DMG | P1 |

---

## Phase 7: VERDICT

### Present Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EVALUATION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Proposal:    <1-line summary>
Verdict:     <GO / NO-GO / CONDITIONAL GO>

Blast Radius:
  CRITICAL:  <N> files
  HIGH:      <N> files
  Total:     <N> files affected

Risks:
  Critical:  <N>
  High:      <N>

Feature Gaps: <N>
Reversibility: <classification>

Key Findings:
  + <pro 1>
  - <con 1>
  ! <warning 1>

Recommended Approach: <approach>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Get Decision

Use `AskUserQuestion`:
- "Go — start building" → Chain into `/build`
- "Go — modify scope first" → Gather modifications, re-assess
- "No-go — not worth it" → Document the decision
- "Need more information" → Targeted research

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Web search returns no results | Rely on codebase analysis and user knowledge |
| Evaluation reveals change is trivial | Suggest skipping evaluation, go to `/build` |
| User wants multiple options | Run analysis for each, create comparison |

---

## Tips

- **Be neutral**: Present evidence, not opinions
- **Quantify**: "11 files affected" > "many files affected"
- **Show your work**: Cite specific files, reference concrete data
- **Think about macOS specifics**: Entitlements, TCC, Hardened Runtime implications
- **Consider the audio pipeline**: Real-time audio is latency-sensitive

Skill: /evaluate
File:  .claude/skills/evaluate/SKILL.md
