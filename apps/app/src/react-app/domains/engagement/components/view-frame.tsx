/** @jsxImportSource react */
import type { ReactNode } from "react";
import { EngagementApiError } from "../api/client";

/**
 * Common chrome around a rendered view: the endpoint it hit, a loading
 * state, an error state that shows the real `EngagementApiError` (a 401
 * from `clearance.py` reads as "no/invalid bearer credential", not a
 * generic failure), and the `truncated` banner FINDINGS.md called out as
 * the failure mode most worth surfacing — a silently partial answer.
 */
export function ViewFrame({
  title,
  endpoint,
  loading,
  error,
  truncated,
  digest,
  children,
}: {
  title: string;
  endpoint: string;
  loading: boolean;
  error: unknown;
  truncated?: boolean;
  digest?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <div className="mb-3 font-mono text-[11px] text-neutral-400">{endpoint}</div>

      {truncated ? (
        <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          truncated — this is a partial answer; not every row is shown.
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-neutral-400">loading…</div>
      ) : error ? (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {error instanceof EngagementApiError
            ? `${error.status} ${error.code ?? ""}: ${error.message}`
            : String(error)}
        </div>
      ) : (
        children
      )}

      {digest ? (
        <div className="mt-3 font-mono text-[10px] text-neutral-400">
          query_digest {digest.slice(0, 16)}…
        </div>
      ) : null}
    </section>
  );
}
