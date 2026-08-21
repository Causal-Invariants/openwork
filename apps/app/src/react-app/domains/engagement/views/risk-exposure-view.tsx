/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { fetchView } from "../api/client";
import type { RiskExposureResponse } from "../api/types";
import { CitationCell } from "../components/citation-cell";
import { Pill } from "../components/pill";
import { ViewFrame } from "../components/view-frame";

const SEVERITY_TONE: Record<string, "ok" | "warn" | "gap"> = {
  low: "ok",
  medium: "warn",
  high: "gap",
  critical: "gap",
};

/** `GET /view-risk-exposure?engagement_id=...` — third-priority view per the
 * lane brief. Capped at 100 rows server-side with a `next_cursor` (FINDINGS
 * section 9's pagination close); this first cut renders page one and shows
 * `truncated` rather than paging automatically. */
export function RiskExposureView({
  engagementId,
  bearerToken,
}: {
  engagementId: string;
  bearerToken: string;
}) {
  const [data, setData] = useState<RiskExposureResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!engagementId || !bearerToken) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchView<RiskExposureResponse>(
      "/view-risk-exposure",
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
      title="Risk exposure"
      endpoint="GET /view-risk-exposure?engagement_id=…"
      loading={loading}
      error={error}
      truncated={data?.truncated}
      digest={data?.query_digest}
    >
      {data ? (
        <>
          <div className="mb-2 text-xs text-neutral-500">
            {data.entries.length} risks · as of {data.as_of ?? "live"}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-400 dark:border-neutral-800">
                <th className="py-1.5 pr-3">Risk</th>
                <th className="py-1.5 pr-3">Severity</th>
                <th className="py-1.5 pr-3">Scope</th>
                <th className="py-1.5 pr-3">Owner</th>
                <th className="py-1.5 pr-3">Stale</th>
                <th className="py-1.5 pr-3">Citation</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr
                  key={entry.fde_id}
                  className="border-b border-neutral-100 align-top dark:border-neutral-800/60"
                >
                  <td className="py-2 pr-3 font-semibold">{entry.title || "(untitled)"}</td>
                  <td className="py-2 pr-3">
                    <Pill tone={SEVERITY_TONE[entry.severity] ?? "neutral"}>
                      {entry.severity}
                    </Pill>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-neutral-500">{entry.scope}</td>
                  <td className="py-2 pr-3 text-neutral-500">{entry.owner ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {entry.is_stale ? <Pill tone="warn">stale</Pill> : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <CitationCell citation={entry.citation} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </ViewFrame>
  );
}
