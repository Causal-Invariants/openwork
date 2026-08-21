/** @jsxImportSource react */
import type { Citation } from "../api/types";

/**
 * Every row on `/view-*` carries its own `citation` — provenance without a
 * second request or a client-side join (FINDINGS.md section 0, point 1).
 * This renders it inline rather than hiding it behind a details toggle,
 * because provenance is a large part of why these payloads are worth a UI.
 *
 * `citation.label` is `null` for some entity types shipped before
 * `populate-citation-labels` landed and for types outside that change's
 * scope (FINDINGS.md section 11) — shown here as "(unlabelled)" rather than
 * hidden, so the gap stays visible instead of silently disappearing.
 */
export function CitationCell({ citation }: { citation: Citation | null | undefined }) {
  if (!citation) return <span className="text-neutral-400">—</span>;
  return (
    <div className="text-xs leading-tight">
      <div className="font-mono text-neutral-500 dark:text-neutral-400">
        {citation.entity_type}:{citation.fde_id.slice(0, 8)}
      </div>
      <div className="text-neutral-400 dark:text-neutral-500">
        {citation.label ?? <span className="italic">(unlabelled)</span>} ·{" "}
        {citation.review_state} · {citation.classification}
        {citation.revision != null ? ` · rev ${citation.revision}` : ""}
      </div>
    </div>
  );
}
