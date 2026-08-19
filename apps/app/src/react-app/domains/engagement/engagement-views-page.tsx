/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useBootState } from "../../shell/boot-state";
import { loadEngagementViewsConfig, saveEngagementViewsConfig } from "./api/config";
import { EngagementSettings } from "./engagement-settings";
import { MilestoneReadinessView } from "./views/milestone-readiness-view";
import { RequirementTraceView } from "./views/requirement-trace-view";
import { RiskExposureView } from "./views/risk-exposure-view";

/**
 * Top-level page for Agent-FDE's engagement read models
 * (`spikes/openwork-ui/FINDINGS.md`, `RECOMMENDATIONS.md` §5). Renders the
 * three views this lane scoped in: `requirement-trace` and
 * `milestone-readiness` (both precompute the derived booleans that render
 * as pills, and both were proven renderable by the spike), plus
 * `risk-exposure`. `open-actions`, `evidence-coverage`, `artefact-status`,
 * `decision-history` and `stakeholder-brief` are not implemented here — see
 * `AGENT-FDE-UI.md` at the repo root for why and what is left.
 *
 * Every fetch goes through `api/client.ts`, which does no reshaping of the
 * response — the spike's finding was that these payloads need none.
 */
export function EngagementViewsPage() {
  const [config, setConfig] = useState(loadEngagementViewsConfig);
  const { markReady, markRouteReady } = useBootState();

  // This route has no workspace/session/engine bootstrap of its own — it is
  // a standalone read-only surface over Agent-FDE. Mark the shell's global
  // boot overlay done immediately on mount rather than leaving it waiting
  // on the session route's workspace refresh, which this route never
  // triggers (`shell/boot-state.tsx`'s `routeReady` is a one-way latch each
  // route is expected to flip for itself).
  useEffect(() => {
    markReady();
    markRouteReady();
  }, [markReady, markRouteReady]);

  const handleConfigChange = (next: typeof config) => {
    setConfig(next);
    saveEngagementViewsConfig(next);
  };

  const ready = Boolean(config.engagementId && config.bearerToken);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Engagement views
      </h1>
      <p className="mb-4 text-sm text-neutral-500">
        Rendered live from Agent-FDE's <code>/view-*</code> HTTP surface — no transformation
        layer between the response and this page.
      </p>

      <EngagementSettings config={config} onChange={handleConfigChange} />

      {ready ? (
        <div className="flex flex-col gap-6">
          <RequirementTraceView engagementId={config.engagementId} bearerToken={config.bearerToken} />
          <MilestoneReadinessView
            engagementId={config.engagementId}
            bearerToken={config.bearerToken}
          />
          <RiskExposureView engagementId={config.engagementId} bearerToken={config.bearerToken} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400 dark:border-neutral-700">
          Enter an engagement id and bearer token above to load views.
        </div>
      )}
    </div>
  );
}
