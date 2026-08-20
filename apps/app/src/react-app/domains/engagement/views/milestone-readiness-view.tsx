/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { fetchView } from "../api/client";
import type { MilestoneReadinessResponse } from "../api/types";
import { CitationCell } from "../components/citation-cell";
import { Pill } from "../components/pill";
import { ViewFrame } from "../components/view-frame";

/**
 * `GET /view-milestone-readiness?engagement_id=...` — `is_ready` is a
 * precomputed boolean (FINDINGS.md section 0, point 2), and the readiness
 * gaps that keep it false (`incomplete_tasks`, `unsatisfied_dependencies`,
 * `unmet_exit_criteria`) ride along in the same row, so a blocked milestone
 * shows *why* without a second request.
 */
export function MilestoneReadinessView({
  engagementId,
  bearerToken,
}: {
  engagementId: string;
  bearerToken: string;
}) {
  const [data, setData] = useState<MilestoneReadinessResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!engagementId || !bearerToken) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchView<MilestoneReadinessResponse>(
      "/view-milestone-readiness",
      { engagement_id: engagementId },
      bearerToken,
    )
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engagementId, bearerToken]);

  return (
    <ViewFrame
      title="Milestone readiness"
      endpoint="GET /view-milestone-readiness?engagement_id=…"
      loading={loading}
      error={error}
      truncated={data?.truncated}
      digest={data?.query_digest}
    >
      {data ? (
        <>
          <div className="mb-2 text-xs text-neutral-500">
            as of {data.as_of ?? "live"}
            {data.as_of_caveat ? ` · ${data.as_of_caveat}` : ""}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-400 dark:border-neutral-800">
                <th className="py-1.5 pr-3">Milestone</th>
                <th className="py-1.5 pr-3">Target</th>
                <th className="py-1.5 pr-3">Status</th>
                <th className="py-1.5 pr-3">Ready</th>
                <th className="py-1.5 pr-3">Blocking gaps</th>
                <th className="py-1.5 pr-3">Citation</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => {
                const gaps = [
                  ...entry.incomplete_tasks.map((v) => `task: ${v}`),
                  ...entry.unsatisfied_dependencies.map((v) => `dependency: ${v}`),
                  ...entry.unmet_exit_criteria.map((v) => `exit criterion: ${v}`),
                ];
                return (
                  <tr
                    key={entry.fde_id}
                    className="border-b border-neutral-100 align-top dark:border-neutral-800/60"
                  >
                    <td className="py-2 pr-3 font-semibold">{entry.name}</td>
                    <td className="py-2 pr-3 text-neutral-500">{entry.target_date}</td>
                    <td className="py-2 pr-3">
                      <Pill tone={entry.status === "on_track" ? "ok" : "warn"}>
                        {entry.status}
                      </Pill>
                    </td>
                    <td className="py-2 pr-3">
                      {entry.is_ready ? (
                        <Pill tone="ok">ready</Pill>
                      ) : (
                        <Pill tone="gap">blocked</Pill>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-neutral-500">
                      {gaps.length ? gaps.join(", ") : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <CitationCell citation={entry.citation} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
    </ViewFrame>
  );
}
