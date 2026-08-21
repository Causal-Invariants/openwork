# Agent-FDE engagement views — Lane 4 (UI fork)

Branch: `agent-fde/engagement-views-ui`, based on `dev` at `34fbb7086`.
New code lives entirely under `apps/app/src/react-app/domains/engagement/`.

**Layout note:** the task brief said `apps/app/src/domains/engagement/`. This
repo's actual convention puts feature domains under
`apps/app/src/react-app/domains/`, so the new folder is at
`apps/app/src/react-app/domains/engagement/` instead — matching sibling
domains rather than the brief's literal path.

## Views: what works, what doesn't

| View | Status | Evidence |
|---|---|---|
| `view-requirement-trace` | **Working end-to-end** | Screenshot below shows 3 rows rendered: statement, `has_coverage` pill (2 red "no evidence", 1 green "covered"), incoming/outgoing link counts, citation cell, `query_digest` footer. |
| `view-milestone-readiness` | Frontend/plumbing correct; **0 rows at runtime** | Headers, `truncated` banner logic, and `is_ready` pill styling all render correctly. Table body is empty — root-caused to a backend defect, not a UI bug (see below). |
| `view-risk-exposure` | Frontend/plumbing correct; **0 rows at runtime** | Same situation as milestone-readiness — same backend defect. |
| `view-open-actions` | **Not attempted** | Deprioritized per scope discipline (get 2-3 views solid, not eight half-done). |
| `view-stakeholder-brief` | **Not attempted** | Explicitly excluded — Lane 2 owns it. |
| `view-evidence-coverage`, `view-artefact-status`, `view-decision-history` | **Not attempted** | Out of scope for this pass. |

Screenshot: `rendered-views.png` at the worktree root. Captured via headless
Chrome CDP against a live Vite dev server proxying a live Agent-FDE ASGI
backend, seeded from `spikes/openwork-ui/probes/01_seed_engagement.sh`. It
shows requirement-trace fully populated, and milestone-readiness /
risk-exposure with correct headers but empty bodies — this is the honest
current state, not a rendering failure.

## The milestone-readiness / risk-exposure defect

This was discovered as a side effect of building the UI, not introduced by
it. Both views were built identically to requirement-trace (same
`fetchView`/`ViewFrame` pattern) and their tables render correctly — they
just never receive rows, over both curl-to-backend and the browser UI.

Root-cause investigation (in-process reproduction, bypassing HTTP,
`agent_fde.api.views.{risk_exposure,milestone_readiness,requirement_trace}`
called directly with one manually-resolved `PermissionPredicate`):

```
principal: Principal(subject='lane4-dev', ..., person_id='fde:stakeholder/01M0E0ZX78EMTMEF2PHFV4HXAN')
clearance: Clearance(classification_ceiling=INTERNAL, scope_refs=frozenset({'01M0E0ZVMTKZ07Y496NKY1BCMZ'}),
                      global_scope=False, principal_refs=frozenset({'01M0E0ZX78EMTMEF2PHFV4HXAN'}))
risk entries: 0 truncated False
milestone entries: 0 truncated False
requirement entries: 3
```

- The clearance/predicate is objectively correct: `scope_refs` matches the
  seeded engagement `01M0E0ZVMTKZ07Y496NKY1BCMZ` exactly, and the sponsor
  stakeholder's authority grant (read from the authoritative `attrs` JSON
  blob, not the denormalized flat columns) shows
  `authority_level: "accountable"`, `scope: {"kind": "engagement", "ref": "01M0E0ZVMTKZ07Y496NKY1BCMZ"}`.
- The same predicate object, passed to `requirement_trace`, returns all 3
  rows. Passed to `risk_exposure` / `milestone_readiness_view`, it returns 0.
- `agent-fde --json view milestone-readiness` / `view risk-exposure` (CLI,
  which uses `default_clearance()` — a different, unrestricted code path)
  confirm the underlying data exists: 1 milestone ("Phase 1 go-live",
  `is_ready: true`) and 2 risk entries with full citations.
- `risk_exposure` and `milestone_readiness_view` both route through the
  generic `RetrievalService` / `ScopeFilter` /
  `permission_predicate_to_scope_filter` pipeline in
  `knowledge/application/retrieval.py`. `requirement_trace` apparently
  applies the same predicate through a different path. This rules out grant
  misconfiguration, scope mismatch, and classification-ceiling mismatch —
  the defect is in how the shared retrieval pipeline applies an otherwise
  correct predicate for these two view types.

This is an Agent-FDE backend defect, not a frontend defect, and fixing it is
outside this lane's remit (Agent-FDE backend is owned by Lanes 1-2). Filed
here for whoever picks it up next. No demo-only workaround (e.g. minting a
global-scope credential) was applied — the screenshot reflects the real,
current behavior of the authenticated HTTP surface.

## Files touched outside `domains/engagement/`

Two files, both minimal and additive:

1. **`apps/app/src/react-app/shell/app-root.tsx`**
   Added one import and one `<Route>` entry for `/engagement-views`,
   pointing at `EngagementViewsPage`, placed before the `/` and `*` fallback
   routes. No existing routes changed.

2. **`apps/app/vite.config.ts`**
   Added an `agentFdeDevTarget` env-gated constant
   (`process.env.AGENT_FDE_DEV_TARGET`) and one new conditional entry in the
   existing `server.proxy` block, alongside the existing `headlessDenTarget`
   / `/api/den` pattern: `/agent-fde-api` → `AGENT_FDE_DEV_TARGET`, stripping
   the `/agent-fde-api` prefix. Inert unless that env var is set, so a normal
   `pnpm dev` is unaffected. This exists because Agent-FDE's CORS wrapper
   (`agent_fde/service/transport.py::with_cors`) only allow-lists the
   `content-type` preflight header, not `authorization` — a credentialed
   cross-origin fetch can never pass a real browser preflight, so the
   dev-server proxy sidesteps CORS by keeping the browser's view same-origin.

## Rebase cost against upstream

- `app-root.tsx`: low risk under normal circumstances (one route, isolated
  from existing entries) — but if upstream restructures the route table
  (e.g. converts to a data-router / lazy-loaded route config, or reorders
  the fallback routes this new route was inserted before), the insertion
  point will need re-locating by hand.
- `vite.config.ts`: low risk — the change follows the existing
  `headlessDenTarget` conditional-proxy pattern exactly, so it should merge
  cleanly unless upstream removes or restructures that pattern itself, in
  which case the new block needs to be re-homed to whatever replaces it.
- `domains/engagement/`: zero rebase cost by construction — a new,
  self-contained directory upstream has no knowledge of. Only conflicts if
  upstream independently creates a same-named directory.

## Toolchain verification

- `pnpm typecheck` (`tsc -p tsconfig.json --noEmit` in `apps/app`): **clean,
  exit 0.**
- Lint: no lint script or ESLint config exists anywhere in this workspace
  (checked `apps/app/package.json`, root `package.json`, `turbo.json`, and
  searched for `.eslintrc*` / `eslint.config*`) — nothing to run.
- `pnpm build`: not run in this pass (typecheck was treated as the
  authoritative "does this compile" signal given no lint step exists;
  build was deprioritized to keep scope to the 2-3 views target).
