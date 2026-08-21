/**
 * Connection settings for the Agent-FDE engagement views.
 *
 * There is no existing OpenWork concept of an Agent-FDE workspace, engagement,
 * or bearer credential, so this domain keeps its own tiny settings blob in
 * `localStorage` rather than reaching into OpenWork's workspace/session
 * state. That is deliberate: it is the smallest thing that lets this folder
 * be deleted cleanly.
 *
 * Auth is mandatory on the Agent-FDE surface (`service/clearance.py` refuses
 * any request it cannot attribute to a principal — no anonymous fallback),
 * so a bearer token must be supplied here. There is no login flow: today the
 * only way to get one is `agent_fde.service.clearance.issue_local_credential`
 * run out-of-band against the workspace, and the resulting token pasted in.
 */

const STORAGE_KEY = "agent-fde.engagement-views.config.v1";

/** Base path this domain calls. In dev this MUST be a same-origin path
 * proxied by Vite (see `vite.config.ts`'s `AGENT_FDE_DEV_TARGET`-gated
 * `/agent-fde-api` proxy) rather than a cross-origin URL: the Agent-FDE
 * CORS wrapper only allow-lists the `content-type` preflight header, not
 * `authorization`, so a bearer-credentialed request cannot pass a real
 * cross-origin preflight (FINDINGS.md section 1 vs. section 2's auth
 * requirement — the two were closed independently and the gap between them
 * is real, not an oversight in this UI). Same-origin sidesteps preflight
 * entirely, which is also the packaged-app story `with_static` is for. */
export const API_BASE = "/agent-fde-api";

export interface EngagementViewsConfig {
  engagementId: string;
  bearerToken: string;
}

const EMPTY_CONFIG: EngagementViewsConfig = { engagementId: "", bearerToken: "" };

export function loadEngagementViewsConfig(): EngagementViewsConfig {
  if (typeof window === "undefined") return EMPTY_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CONFIG;
    const parsed = JSON.parse(raw) as Partial<EngagementViewsConfig>;
    return {
      engagementId: parsed.engagementId ?? "",
      bearerToken: parsed.bearerToken ?? "",
    };
  } catch {
    return EMPTY_CONFIG;
  }
}

export function saveEngagementViewsConfig(config: EngagementViewsConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
