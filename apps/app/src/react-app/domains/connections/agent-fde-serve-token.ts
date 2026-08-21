// Naming the environment slot one workspace's agent-fde serve token lives in.
//
// OpenWork's user env store is per user (apps/server/src/env-file.ts: "Scope:
// user/machine, not workspace"), while an agent-fde credential resolves a
// principal only in the workspace it was issued for --
// LocalCredentialReader.for_workspace consults that workspace's
// credentials.json and nothing else. Keeping every workspace's token under one
// key therefore means connecting a second workspace overwrites the first one's
// token, and every call against the first is refused from then on. The failure
// is total rather than partial, and no amount of operator care avoids it,
// because there is only one slot.
//
// So the slot is keyed by workspace. Nothing here writes it: a person pastes
// the value into Settings -> Environment Variables, and `agent-fde mcp
// issue-credential` prints the name to store it under. That makes the
// derivation below a contract with another repository, with nothing linking
// the two implementations at build time -- which is why the test beside this
// file pins a literal name for a literal path rather than only checking the
// shape. The matching pin lives in agent-fde's
// tests/unit/test_mcp_workspace_token_env_var.py. Change one and you must
// change the other, or every provisioned workspace silently stops resolving.
//
// The peer implementation is agent_fde/mcp/provisioning.py.

/** The unkeyed name. Still read as a fallback so a workspace provisioned
 *  before this change keeps working with no operator action. */
export const AGENT_FDE_SERVE_TOKEN_KEY = "MCP_SERVE_TOKEN";

/** Hex characters of the path digest kept in the derived name. Long enough not
 *  to collide across the workspaces one person connects, short enough to
 *  compare by eye. Not a security boundary: a collision would hand over the
 *  wrong token, which agent-fde then refuses by name. */
const DIGEST_LENGTH = 12;

/**
 * The workspace path as both sides agree to spell it before digesting.
 *
 * Lexical only: absolute, no trailing separator, empty and "." segments
 * dropped, ".." left alone. Deliberately no symlink resolution and no
 * filesystem call at all. Resolving symlinks would key a moved-but-symlinked
 * workspace more stably, but it requires behaviour the two implementations
 * would have to match exactly, and any divergence produces a key that never
 * matches -- the failure this module exists to remove. ".." is kept rather
 * than collapsed because collapsing it correctly is precisely the thing that
 * needs to know what is a symlink.
 *
 * Python's pathlib applies the same rules, so `Path(p).as_posix()` and this
 * agree for every absolute POSIX path that does not begin with exactly two
 * slashes -- a spelling POSIX reserves and neither side produces.
 *
 * This repo's normalizeDirectoryPath is deliberately not reused: it is
 * documented as being for comparison, and it lower-cases on macOS and Windows.
 * Python's pathlib does not, so reusing it would make the two sides derive
 * different names for the same workspace on exactly those platforms.
 */
const normalizeWorkspacePath = (workspaceDir: string): string => {
  const segments = workspaceDir.split("/").filter((segment) => segment !== "" && segment !== ".");
  return `/${segments.join("/")}`;
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * The environment variable a host stores *this* workspace's token under.
 *
 * Stable for one path, distinct for distinct paths. Returns null for anything
 * that is not an absolute path, since a relative one cannot be resolved here
 * without a working directory the renderer does not have -- the caller then
 * falls back to the unkeyed name rather than guessing at a slot.
 */
export const workspaceServeTokenKey = async (workspaceDir: string): Promise<string | null> => {
  const trimmed = workspaceDir.trim();
  if (!trimmed.startsWith("/")) return null;
  const encoded = new TextEncoder().encode(normalizeWorkspacePath(trimmed));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hex = toHex(new Uint8Array(digest));
  return `${AGENT_FDE_SERVE_TOKEN_KEY}__${hex.slice(0, DIGEST_LENGTH).toUpperCase()}`;
};
