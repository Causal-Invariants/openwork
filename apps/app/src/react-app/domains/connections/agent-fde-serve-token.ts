/**
 * Where an agent-fde serve token lives in OpenWork's user-level env store.
 *
 * Agent-FDE issues a credential against one workspace, but OpenWork's env
 * store (apps/server/src/env-file.ts) is user-level: one flat namespace for
 * the whole install. Storing every workspace's token under the same
 * `MCP_SERVE_TOKEN` key therefore meant one provisioned workspace at a time --
 * connecting a second engagement silently overwrote the first. Keying the
 * *storage slot* by workspace root removes that collision without needing a
 * per-workspace store.
 *
 * The name handed to the child process is still the plain `MCP_SERVE_TOKEN`:
 * that is what `agent-fde mcp launch` reads, and it is not ours to rename.
 * The keyed name is a lookup key here and nowhere else.
 *
 * The derivation below is a port of Agent-FDE's
 * `src/agent_fde/mcp/provisioning.py::workspace_token_env_var`. Both sides
 * must produce the same name for the same workspace or a provisioned token
 * becomes invisible, so the pinned pairs in
 * `tests/agent-fde-serve-token.test.ts` are asserted literally on both sides.
 */

/** The unkeyed key: still the env var name the launched child is given. */
export const AGENT_FDE_SERVE_TOKEN_KEY = "MCP_SERVE_TOKEN";

/** Digest characters kept in the suffix, matching the Python constant. */
const WORKSPACE_KEY_DIGEST_LENGTH = 12;

/**
 * Reproduce `Path(workspace_root).expanduser().as_posix()`.
 *
 * Normalisation is deliberately *lexical*: no `realpath`, no `stat`, no
 * filesystem call of any kind. Two reasons. First, the Python side derives
 * the same name from a workspace root that may not exist yet on the host that
 * provisions it, so a resolving step would be undefined there. Second, a
 * resolving step is not a function of the string -- a symlink that is
 * retargeted, or a mount that appears, would change the derived name for a
 * workspace the user never touched, orphaning their token.
 *
 * That is also why ".." is left standing rather than collapsed. Collapsing it
 * is only correct once you know whether each preceding segment is a symlink,
 * which is exactly the filesystem question we refuse to ask; `/a/b/c/../..`
 * and `/a` are genuinely different strings and are allowed to derive
 * different names. Note that `path.normalize()` collapses them and is
 * therefore the wrong tool here, however close it otherwise looks.
 */
export function normaliseWorkspaceRoot(workspaceRoot: string): string {
  const expanded = expandLeadingTilde(workspaceRoot);
  // PurePosixPath keeps exactly two leading slashes ("//host/share") and
  // folds any other run down to one.
  const leading = /^\/*/.exec(expanded)?.[0].length ?? 0;
  const root = leading === 2 ? "//" : leading > 0 ? "/" : "";
  const segments = expanded.split("/").filter((segment) => segment !== "" && segment !== ".");
  const joined = segments.join("/");
  if (!root) return joined;
  return joined ? `${root}${joined}` : root;
}

function expandLeadingTilde(workspaceRoot: string): string {
  if (!workspaceRoot.startsWith("~")) return workspaceRoot;
  const firstSegment = workspaceRoot.split("/", 1)[0];
  // "~otheruser" needs a passwd lookup, which is a filesystem question; the
  // host only ever hands us its own workspace roots, so leave it verbatim
  // rather than guess wrong.
  if (firstSegment !== "~") return workspaceRoot;
  const home = homeDirectory();
  if (!home) return workspaceRoot;
  return `${home}${workspaceRoot.slice(1)}`;
}

function homeDirectory(): string | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.HOME?.trim() || null;
}

/**
 * The user-env key a workspace's serve token is stored under.
 *
 * Async because the digest comes from Web Crypto rather than node's
 * `crypto.createHash`: this module is bundled into the renderer, where
 * `node:crypto` does not resolve, and pulling in a hashing dependency for one
 * twelve-character suffix is not worth the weight. `crypto.subtle` is absent
 * outside a secure context, in which case this rejects and the caller falls
 * back to the unkeyed key.
 */
export async function workspaceServeTokenEnvVar(workspaceRoot: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SubtleCrypto is unavailable; cannot derive the keyed serve-token name.");
  const encoded = new TextEncoder().encode(normaliseWorkspaceRoot(workspaceRoot));
  const digest = await subtle.digest("SHA-256", encoded);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${AGENT_FDE_SERVE_TOKEN_KEY}__${hex.slice(0, WORKSPACE_KEY_DIGEST_LENGTH).toUpperCase()}`;
}

/** Reads one user-env value; resolves to null/undefined, or throws, when unset. */
export type UserEnvReader = (key: string) => Promise<string | null | undefined>;

/**
 * Look the serve token up for a workspace, keyed name first.
 *
 * The unkeyed fallback is a migration path, not a default: workspaces
 * provisioned before this change have their token under the bare
 * `MCP_SERVE_TOKEN` and would otherwise go dark on upgrade. It also covers
 * the environment where the derivation itself is unavailable.
 *
 * Every lookup failure is swallowed. An unset token is the ordinary case, not
 * a fault: the connection still comes up and the eight view tools still list,
 * and only calling them is refused -- which is agent-fde's designed posture
 * rather than a misconfiguration.
 */
export async function readWorkspaceServeToken(
  workspaceRoot: string | null | undefined,
  readUserEnv: UserEnvReader,
): Promise<string | null> {
  const keys: string[] = [];
  if (workspaceRoot?.trim()) {
    try {
      keys.push(await workspaceServeTokenEnvVar(workspaceRoot));
    } catch {
      // No derivation available: the unkeyed key below is the only chance.
    }
  }
  keys.push(AGENT_FDE_SERVE_TOKEN_KEY);

  for (const key of keys) {
    try {
      const value = (await readUserEnv(key))?.trim();
      if (value) return value;
    } catch {
      // An unset key throws here; keep going to the fallback key.
    }
  }
  return null;
}
