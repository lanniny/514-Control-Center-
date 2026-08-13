# 514 Forge: Codeg + LiveAgent convergence

Status: active implementation proposal  
Date: 2026-07-23  
Framework version: remains `3.5.0`

## 1. Objective

514 Forge will absorb the complete product capability categories demonstrated by Codeg and LiveAgent without replacing its existing control plane or flattening every Agent into one provider runtime. The product differentiator remains a governed, heterogeneous CLI team: Claude, Codex, Grok, Kimi and Pi retain distinct native sessions, permissions, capabilities and failure semantics while collaborating through one visible task system.

“Complete” is measured by the capability ledger, not by visual similarity or README claims. Every capability must have:

1. current upstream source evidence;
2. a Forge implementation or an explicit security/license blocker;
3. a user-visible entry;
4. automated verification;
5. a rollback or compatibility boundary.

The live ledger is:

`.workflow/ultracode/codeg-liveagent-convergence-20260723/capability-ledger.md`

## 2. Fixed upstream evidence

| Project | Fixed revision | License | Main strengths |
|---|---|---|---|
| CodeG | `cbb00d7e099022530b44b512f19db8ffc2a08066` / manifest version `0.21.5` (no local tag ref at HEAD) | Apache-2.0 | ACP registry, sessions, rich Agent workbench, file/Git/terminal, automation, MCP, Office and channels |
| LiveAgent | `61b7bccaeca79e667aff0369eff07295438b3696` | MIT | persisted subagent roster/bus/checkpoints, worktree settlement, terminal/SSH/SFTP, right-dock registry and remote Gateway |

The current source-audit truth is `.workflow/ultracode/codeg-liveagent-fusion-20260723/results/`; the capability-ledger truth is `.workflow/ultracode/codeg-liveagent-convergence-20260723/capability-ledger.md`. The older convergence `results/` and the fusion `results/` are different snapshots and must not be interchanged. Upstream code is research input in this phase; no upstream product source or brand asset has been copied into Forge.

## 3. Architecture decision

### Adopted: compositional kernel

Keep the existing Node HTTP/SSE control plane, adapter runtime, approval broker, event store and Tauri shell. Add upstream mechanisms as bounded domain services and typed API contracts.

```text
Browser / Tauri WebView
  -> Work / Observe / Configure
  -> HTTP commands + bounded SSE/NDJSON queries
Node control plane
  -> Workspace / Project / Session
  -> Run / Task / Delegation / TaskAttempt
  -> Approval / CapabilityLease
  -> Artifact / Worktree / Process
  -> Provider / MCP / Skill / Channel integrations
Persistence
  -> append-only event and bus segments
  -> versioned control state
  -> filesystem and Git artifacts
  -> optional SQLite metadata after migration tooling exists
Runtime
  -> heterogeneous Claude/Codex/Grok/Kimi/Pi adapters
```

### Rejected: whole Codeg fork

A fork would replace a mature Node control plane with a second Next/Rust/SeaORM stack, split governance and make every upstream upgrade a manual merge. Codeg also carries giant 2,000-10,995-line UI components that reproduce Forge's current monolith problem.

### Deferred: LiveAgent Gateway as the kernel

The Go Gateway is useful when remote multi-device operation becomes the primary product. Today it would introduce a third runtime and duplicate persistence. Forge first defines replay, authentication, capability and audit contracts locally; a Gateway can implement those contracts later.

## 4. Unified object model

| Object | Meaning | Invariant |
|---|---|---|
| Workspace | policy, event and retention boundary | secrets and authority never cross it implicitly |
| Project | canonical real directory and VCS identity | worktree is not a second Project |
| Session | long-lived conversation container | Session is not Run |
| Run | one triggered execution | automation creates a new Run each time |
| Task | smallest schedulable objective | status changes are explicit and versioned |
| Delegation | directed parent/child Task edge | acyclic, depth-limited and cancel-scoped |
| TaskAttempt | one provider/native-session execution | provider can change without changing Agent identity |
| Agent | stable team/governance identity | provider/runtime is a binding, not identity |
| Artifact | file, diff, log, report or handoff | digest and producer provenance are immutable |
| Integration | CLI, ACP, MCP, Gateway or channel connection | secrets are references, capabilities are snapshotted |
| CapabilityLease | time/action/scope-bound authority | action hash, attempt, worktree and TTL must all match |

Run and Task states converge on:

`queued -> running -> waiting_approval|waiting_agent -> settling -> terminal`

Build recovery without a verifiable checkpoint and native lineage remains `recovery_required`. Cancellation first wins a compare-and-set into `cancelling`, then cascades by `self|descendants|run`, and finally performs idempotent teardown.

## 5. Product information architecture

Top-level navigation converges to three work domains:

- **Work**: project/session rail, transcript/composer and Mission Control Dock.
- **Observe**: system health, costs, route decisions, performance and Evidence Graph.
- **Configure**: Agents, providers, capabilities, automations, MCP, Skills and source truth.

The first slice evolves the existing workbench rather than adding another page:

| Dock tab | User outcome |
|---|---|
| Tasks | root task, attempts, directed delegation and current assignee/status |
| Artifacts | worktree, changed files, diff, logs and future file/terminal artifacts |
| Evidence | bounded run-level relationship graph across Task, Agent, Attempt, Delegation, Approval, Artifact and event evidence |
| Activity | bounded event timeline with provenance |
| Connections | roster, provider/native session and health/capability state |

The UI remains quiet, dense and tool-first: VS Code information hierarchy, Codex Desktop task focus and Claude Desktop reading clarity, with Forge's own graphite/white/rose identity. It does not copy either upstream's brand skin.

### Current disk WIP slice (2026-07-23)

The first user-visible convergence slice is implemented in the shared working tree, but is not a released `v3.5.0` capability and has not been runtime-synced:

- Mission Control snapshot `v2` adds a bounded run-level Evidence Graph instead of presenting an Agent's completion text as proof by itself.
- The right dock is driven by `MISSION_PANEL_REGISTRY` and exposes Tasks, Artifacts, Evidence, Activity and Connections through one ARIA tab contract.
- Workspace Artifact opens a run-scoped file tree and text preview. A 4096-entry scan/240-entry response budget, 256 KiB preview budget, strict UTF-8 classification, sensitive-path/high-entropy denial, link-chain rejection and opened-handle identity rechecks are mandatory. On Win32 this is intentionally fail-closed user-space defense; it is not described as an atomic `openat` guarantee.
- Mission reads the bus through a cancel-aware 256 KiB/256-message tail. Malformed, truncated or unreadable JSONL must remain visible as degraded evidence rather than being normalized to an empty artifact.
- The graph and Artifact list remain read models. They do not yet constitute persisted Task DAGs, immutable Artifact digests, acceptance gates or approval-bound apply.

This slice advances ledger rows `EX-10`, `EX-20A`, `UX-02` and `UX-10A`. Rows `EX-11`, `EX-20B`, `AG-12B`, `AG-13`, `AG-14` and `UX-10B` remain blocked.

## 6. Differentiating innovations

### Evidence Graph (target state)

Events, bus messages, memo, approval, task attempts, artifacts, native session lineage, handoffs and DELTA become one queryable provenance graph. A conclusion can answer who produced it, using what evidence, in which attempt and under which authority. The current WIP is only a run-scoped projection; cross-run governance provenance remains a target.

### Capability Lease

The current action-hash approval becomes a visible, revocable, short-lived lease scoped to an attempt and worktree. A global-looking Skill toggle must never be presented as enforcement until the real adapter/harness boundary rejects unauthorized invocation.

### Heterogeneous Replay

Recovery is provider-aware. A Codex native session is not silently treated like Claude, Pi or Grok. Stable Agent identity and Artifact lineage survive provider rebinding; native session ids remain immutable history.

### Counterfactual Dispatch

High-risk work can produce an isolated verification branch. The verifier receives evidence and acceptance criteria rather than the executor's entire reasoning context. Artifact and DELTA comparison feeds future routing quality.

## 7. Ordered implementation program

### Wave A: trust foundation

- fixed upstream audits and capability ledger;
- fail-closed capability state;
- corrupt automation state preservation;
- unified non-Claude session discovery;
- API response schemas for new control surfaces.

### Wave B: Mission Control (in progress)

- typed task/delegation projection;
- registry-driven Task/Artifact/Activity/Connection dock;
- explicit delegation cards and cancel status;
- Artifact availability/read-model projection for bus, worktree and diff; immutable provenance remains blocked under `EX-20B`.

### Wave C: developer workspace (read/preview slice implemented in current WIP)

- root-confined file tree and preview;
- Git status/log/stage/commit/branch/stash;
- scoped PTY and managed process journal;
- worktree settlement with approval and conflict-safe apply.

### Wave D: operations and intelligence

- full automation editor/history/recovery and CAS claim;
- Skill/MCP staged jobs, diagnostics and provenance;
- curated memory candidate/review/accept workflow;
- command palette and Agent mention routing.

### Wave E: gated expansion

- Office tools and previews;
- SSH/SFTP and tunnels;
- external chat channels;
- remote Gateway/mobile Web access;
- unified backup/restore and signed updater.

Wave E remains blocked until secret vault references, host verification, Origin/CSRF policy, user/RBAC model, audit durability, rate limits, signed/pinned installation and recovery tooling exist.

## 8. Security and license exclusions

Forge will not import:

- Codeg plaintext token stores;
- permissive CORS or public default binding;
- remote `iex/bash` installers;
- LiveAgent path allowlists presented as human approval;
- a provider-equals-Agent data model;
- process-local replay presented as exactly-once;
- unlicensed Expert skill content or upstream brand assets.

Any future copied code requires `THIRD_PARTY_NOTICES.md`, SPDX metadata, an SBOM entry and file-level provenance. Apache-2.0 modifications must be marked and notices preserved; MIT copyright/license text must remain.

## 9. Verification contract

- Four viewports: `1440x900`, `1280x800`, `820x1180`, `390x844`.
- No horizontal overflow, control overlap, inaccessible icon or keyboard trap.
- 160-message DOM and 40 MiB event-surface bounds do not regress.
- 5,000-event history and 4 MiB-class payload guards remain green.
- Task/delegation cancellation races produce one terminal state.
- Worktree conflicts never modify the main tree.
- Control-state corruption is visible and cannot trigger a replacement write.
- Provider changes preserve stable Agent/Session/Artifact lineage.
- Every ledger row moves out of `blocked` only with a user entry and automated proof.

## 10. Completion honesty

The presence of blocked ledger rows means full Codeg + LiveAgent parity is not yet complete. This proposal defines the path and the mechanical completion gate; each wave must update the ledger, tests and a 514cc handoff before it can be called delivered.
