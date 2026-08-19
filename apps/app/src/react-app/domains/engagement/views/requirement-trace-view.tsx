/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { fetchView } from "../api/client";
import type { RequirementTraceResponse } from "../api/types";
import { CitationCell } from "../components/citation-cell";
import { Pill } from "../components/pill";
import { ViewFrame } from "../components/view-frame";

/**
 * `GET /view-requirement-trace?engagement_id=...` — the primary view named
 * by the lane brief. `has_coverage` is precomputed server-side (FINDINGS.md
 * section 0, point 2) and rendered directly as a pill, with no client
 * derivation.
 */
export function RequirementTraceView({
  engagementId,
  bearerToken,
}: {
  engagementId: string;
  bearerToken: string;
}) {
  const [data, setData] = useState<RequirementTraceResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!engagementId || !bearerToken) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchView<RequirementTraceResponse>(
      "/view-requirement-trace",
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
      title="Requirement trace"
      endpoint="GET /view-requirement-trace?engagement_id=…"
      loading={loading}
      error={error}
      truncated={data?.truncated}
      digest={data?.query_digest}
    >
      {data ? (
        <>
          <div className="mb-2 text-xs text-neutral-500">
            {data.count} requirements · baseline: {data.baseline ?? "none"}
            {data.as_of_caveat ? ` · ${data.as_of_caveat}` : ""}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-400 dark:border-neutral-800">
                <th className="py-1.5 pr-3">Key</th>
                <th className="py-1.5 pr-3">Statement</th>
                <th className="py-1.5 pr-3">Coverage</th>
                <th className="py-1.5 pr-3">Links</th>
                <th className="py-1.5 pr-3">Citation</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => {
                const linkCount = entry.outgoing.length + entry.incoming.length;
                return (
                  <tr
                    key={entry.requirement.fde_id}
                    className="border-b border-neutral-100 align-top dark:border-neutral-800/60"
                  >
                    <td className="py-2 pr-3 font-mono font-semibold">{entry.requirement.key}</td>
                    <td className="py-2 pr-3">{entry.requirement.statement}</td>
                    <td className="py-2 pr-3">
                      {entry.has_coverage ? (
                        <Pill tone="ok">covered</Pill>
                      ) : (
                        <Pill tone="gap">no evidence</Pill>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-neutral-500">{linkCount || "0"}</td>
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
