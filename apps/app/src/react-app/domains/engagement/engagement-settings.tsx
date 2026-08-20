/** @jsxImportSource react */
import { useState } from "react";
import type { EngagementViewsConfig } from "./api/config";

/**
 * Connection form: engagement id + bearer token. There is no login flow
 * here (see `api/config.ts`) — the token is minted out-of-band with
 * `issue_local_credential` and pasted in once; it is kept in
 * `localStorage`, never sent anywhere but the configured Agent-FDE origin.
 */
export function EngagementSettings({
  config,
  onChange,
}: {
  config: EngagementViewsConfig;
  onChange: (next: EngagementViewsConfig) => void;
}) {
  const [draft, setDraft] = useState(config);

  return (
    <form
      className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900/50"
      onSubmit={(event) => {
        event.preventDefault();
        onChange(draft);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-500">Engagement id</span>
        <input
          className="w-72 rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
          value={draft.engagementId}
          onChange={(event) => setDraft({ ...draft, engagementId: event.target.value })}
          placeholder="01M06..."
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-500">Bearer token</span>
        <input
          className="w-72 rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
          type="password"
          value={draft.bearerToken}
          onChange={(event) => setDraft({ ...draft, bearerToken: event.target.value })}
          placeholder="issued by issue_local_credential"
        />
      </label>
      <button
        type="submit"
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Connect
      </button>
    </form>
  );
}
