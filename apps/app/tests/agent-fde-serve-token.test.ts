import { describe, expect, test } from "bun:test";

import {
  AGENT_FDE_SERVE_TOKEN_KEY,
  readWorkspaceServeToken,
  workspaceServeTokenEnvVar,
} from "@/react-app/domains/connections/agent-fde-serve-token";

/**
 * A stand-in for `openworkClient.getUserEnv`: the real one throws on a key
 * that is not present, so the fake does too. That is the behaviour the
 * fallback has to survive, not a convenience.
 */
function fakeUserEnv(entries: Record<string, string>) {
  const reads: string[] = [];
  const read = async (key: string) => {
    reads.push(key);
    if (!(key in entries)) throw new Error(`404 no such env key: ${key}`);
    return entries[key];
  };
  return { read, reads };
}

describe("agent-fde serve token env var", () => {
  // Asserted literally rather than recomputed: these exact strings are pinned
  // on the Agent-FDE side in
  // tests/unit/test_mcp_workspace_token_env_var.py::TestTheContractWithTheHost.
  // If either side drifts, a provisioned token stops being found, and only a
  // literal on both sides catches that.
  test("matches the names pinned on the Agent-FDE side", async () => {
    expect(await workspaceServeTokenEnvVar("/home/someone/work/engagement-a")).toBe(
      "MCP_SERVE_TOKEN__3251FBD65DA3",
    );
    expect(await workspaceServeTokenEnvVar("/tmp/Ünïcødé workspace/eng")).toBe(
      "MCP_SERVE_TOKEN__C2371D0E7371",
    );
    expect(await workspaceServeTokenEnvVar("/a/b/c/../..")).toBe("MCP_SERVE_TOKEN__CFC7BEFA3F34");
  });

  test("is stable per path and distinct across paths", async () => {
    const a = await workspaceServeTokenEnvVar("/home/someone/work/engagement-a");
    const again = await workspaceServeTokenEnvVar("/home/someone/work/engagement-a");
    const b = await workspaceServeTokenEnvVar("/home/someone/work/engagement-b");
    expect(again).toBe(a);
    expect(b).not.toBe(a);
  });

  // Spellings a path picker or a hand-typed path can differ in, none of which
  // mean a different directory. They must not fragment one workspace's token
  // across several storage slots.
  test("ignores trailing separators, '.' segments and duplicate slashes", async () => {
    const clean = await workspaceServeTokenEnvVar("/home/someone/work/engagement-a");
    expect(await workspaceServeTokenEnvVar("/home/someone/work/engagement-a/")).toBe(clean);
    expect(await workspaceServeTokenEnvVar("/home/someone/work/./engagement-a")).toBe(clean);
    expect(await workspaceServeTokenEnvVar("/home/someone//work/engagement-a")).toBe(clean);
  });

  // POSIX gives a path beginning with exactly two slashes an
  // implementation-defined meaning, and Python's PurePosixPath preserves that
  // pair while folding any longer run down to one. The two names below are
  // pinned from the Python side precisely because they DIFFER: a port that
  // treated all leading slashes alike would collapse them together and hand
  // back the wrong slot for one of the two.
  test("keeps exactly two leading slashes distinct from three", async () => {
    expect(await workspaceServeTokenEnvVar("//host/share/eng")).toBe("MCP_SERVE_TOKEN__9F160A37566C");
    expect(await workspaceServeTokenEnvVar("///host/share/eng")).toBe("MCP_SERVE_TOKEN__074BF4E1D289");
  });

  // A bare leading "~" is expanded from HOME on both sides. "~otheruser" is
  // NOT: expanding it needs a passwd lookup, which is the filesystem question
  // this derivation refuses to ask. The two sides diverge here -- Python's
  // expanduser raises for an unknown user where this returns the string
  // verbatim -- and that divergence is pinned rather than papered over,
  // because the host only ever hands over its own already-resolved workspace
  // roots and neither behaviour is reachable through resolveLocalMcpEnvironment.
  test("expands a bare '~' and leaves '~otheruser' alone", async () => {
    const home = process.env.HOME;
    expect(home).toBeTruthy();
    expect(await workspaceServeTokenEnvVar("~/work/eng")).toBe(
      await workspaceServeTokenEnvVar(`${home}/work/eng`),
    );
    expect(await workspaceServeTokenEnvVar("~someoneelse/work/eng")).not.toBe(
      await workspaceServeTokenEnvVar(`${home}/work/eng`),
    );
  });

  // ".." is left standing on purpose: collapsing it is only sound once you
  // know whether the preceding segments are symlinks, and the derivation
  // makes no filesystem call at all. `path.normalize` would fold these
  // together and break the contract with the Python side.
  test("does not collapse '..'", async () => {
    expect(await workspaceServeTokenEnvVar("/a/b/c/../..")).not.toBe(
      await workspaceServeTokenEnvVar("/a"),
    );
  });

  test("is a legal environment variable name with no reserved prefix", async () => {
    const name = await workspaceServeTokenEnvVar("/tmp/Ünïcødé workspace/eng");
    expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    expect(name.startsWith(`${AGENT_FDE_SERVE_TOKEN_KEY}__`)).toBe(true);
    // Neither the POSIX-reserved "_"-leading form nor any of the shell/loader
    // prefixes that a launched child would treat specially.
    expect(name.startsWith("_")).toBe(false);
    expect(name.startsWith("LD_")).toBe(false);
    expect(name.startsWith("BASH_")).toBe(false);
  });
});

describe("reading the serve token for a workspace", () => {
  const workspace = "/home/someone/work/engagement-a";

  test("prefers the keyed entry over an unkeyed one", async () => {
    const keyed = await workspaceServeTokenEnvVar(workspace);
    const env = fakeUserEnv({ [keyed]: "keyed-token", [AGENT_FDE_SERVE_TOKEN_KEY]: "unkeyed-token" });

    expect(await readWorkspaceServeToken(workspace, env.read)).toBe("keyed-token");
    expect(env.reads).toEqual([keyed]);
  });

  // The migration case: a workspace provisioned before the token was keyed
  // still has its token under the bare name, and must keep working.
  test("falls back to an unkeyed entry when no keyed entry exists", async () => {
    const env = fakeUserEnv({ [AGENT_FDE_SERVE_TOKEN_KEY]: "  legacy-token  " });

    expect(await readWorkspaceServeToken(workspace, env.read)).toBe("legacy-token");
    expect(env.reads).toEqual([await workspaceServeTokenEnvVar(workspace), AGENT_FDE_SERVE_TOKEN_KEY]);
  });

  test("treats an empty keyed entry as absent and falls through", async () => {
    const keyed = await workspaceServeTokenEnvVar(workspace);
    const env = fakeUserEnv({ [keyed]: "   ", [AGENT_FDE_SERVE_TOKEN_KEY]: "legacy-token" });

    expect(await readWorkspaceServeToken(workspace, env.read)).toBe("legacy-token");
  });

  test("returns null when neither entry is provisioned", async () => {
    const env = fakeUserEnv({});
    expect(await readWorkspaceServeToken(workspace, env.read)).toBeNull();
  });

  test("does not confuse one workspace's token for another's", async () => {
    const other = "/home/someone/work/engagement-b";
    const env = fakeUserEnv({ [await workspaceServeTokenEnvVar(other)]: "other-token" });

    expect(await readWorkspaceServeToken(workspace, env.read)).toBeNull();
    expect(await readWorkspaceServeToken(other, env.read)).toBe("other-token");
  });
});
