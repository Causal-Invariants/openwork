import { API_BASE } from "./config";
import type { ApiErrorBody } from "./types";

export class EngagementApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Fetch a `/view-*` endpoint with the bearer credential the Agent-FDE
 * surface requires (`service/clearance.py` — there is no anonymous
 * fallback). Every parameter beyond `path`/`params` is a plain query string:
 * this client does no reshaping of the response, matching the spike's
 * finding that these payloads are directly renderable.
 */
export async function fetchView<T>(
  path: string,
  params: Record<string, string | undefined>,
  bearerToken: string,
): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const query = search.toString();
  const url = `${API_BASE}${path}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    headers: bearerToken ? { authorization: `Bearer ${bearerToken}` } : {},
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body?.error?.message) message = body.error.message;
      code = body?.error?.code;
    } catch {
      // Non-JSON error body (e.g. a proxy failure) — keep the status text.
    }
    throw new EngagementApiError(response.status, message, code);
  }

  return (await response.json()) as T;
}
