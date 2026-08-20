/**
 * Shapes returned by Agent-FDE's `/view-*` HTTP surface, transcribed from the
 * route handlers in `agent_fde/service/asgi.py` (not guessed, not a
 * transformation of them) — see
 * `spikes/openwork-ui/FINDINGS.md` sections 0, 8-12 for how this was
 * established. Every response carries `query_digest`; most carry
 * `truncated`. `citation.provenance` arrives double-JSON-encoded (FINDINGS
 * section 7) and is intentionally left untouched here — nothing in this
 * folder parses it.
 */

export interface Citation {
  entity_type: string;
  fde_id: string;
  label: string | null;
  classification: string;
  review_state: string;
  engagement_id?: string | null;
  revision?: number | null;
  recorded_at: string;
  provenance?: string | null;
  source?: string | null;
}

export interface RequirementPayload {
  fde_id: string;
  engagement: string;
  key: string;
  statement: string;
  kind: string;
  priority: string;
  review_state: string;
}

export interface TraceLinkPayload {
  fde_id: string;
  source: string;
  target: string;
  link_type: string;
}

export interface RequirementTraceEntry {
  requirement: RequirementPayload;
  citation: Citation;
  outgoing: TraceLinkPayload[];
  incoming: TraceLinkPayload[];
  has_coverage: boolean;
}

export interface RequirementTraceResponse {
  count: number;
  entries: RequirementTraceEntry[];
  baseline: string | null;
  as_of_caveat: string | null;
  truncated: boolean;
  next_cursor: string | null;
  query_digest: string;
}

export interface MilestoneReadinessEntry {
  fde_id: string;
  name: string;
  target_date: string;
  status: string;
  is_ready: boolean;
  incomplete_tasks: string[];
  unsatisfied_dependencies: string[];
  unmet_exit_criteria: string[];
  citation: Citation;
}

export interface MilestoneReadinessResponse {
  engagement_id: string;
  as_of: string | null;
  as_of_caveat: string | null;
  truncated: boolean;
  query_digest: string;
  entries: MilestoneReadinessEntry[];
}

export interface RiskExposureEntry {
  fde_id: string;
  title: string;
  scope: string;
  probability: string;
  impact: string;
  severity: string;
  owner: string | null;
  closed_on: string | null;
  is_stale: boolean;
  citation: Citation;
}

export interface RiskExposureResponse {
  engagement_id: string;
  as_of: string | null;
  truncated: boolean;
  next_cursor: string | null;
  query_digest: string;
  entries: RiskExposureEntry[];
}

/** The `{"error": {"code", "message", "details"}}` shape every `agent-fde`
 * HTTP error returns, including the 401 `clearance.py` issues when a request
 * cannot be attributed to a principal. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
