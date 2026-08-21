import { describe, expect, test } from "bun:test";

import {
  AGENT_FDE_SERVE_TOKEN_KEY,
  workspaceServeTokenKey,
} from "../src/react-app/domains/connections/agent-fde-serve-token";

describe("agent-fde serve token key", () => {
  test("carries the unkeyed name as a readable prefix", async () => {
    const key = await workspaceServeTokenKey("/home/someone/work/engagement-a");
    expect(key?.startsWith(`${AGENT_FDE_SERVE_TOKEN_KEY}__`)).toBe(true);
  });

  test("is a legal env key and uses no reserved prefix", async () => {
    // apps/server/src/env-file.ts validates against this pattern and rejects
    // the OPENWORK_ and OPENCODE_ prefixes. A name failing either could not be
    // stored at all, so the operator could never provision a workspace.
    const key = await workspaceServeTokenKey("/home/someone/work/engagement-a");
    expect(key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    expect(key?.startsWith("OPENWORK_")).toBe(false);
    expect(key?.startsWith("OPENCODE_")).toBe(false);
  });

  test("is stable for one path and distinct across paths", async () => {
    const a = await workspaceServeTokenKey("/home/someone/work/engagement-a");
    const again = await workspaceServeTokenKey("/home/someone/work/engagement-a");
    const b = await workspaceServeTokenKey("/home/someone/work/engagement-b");
    expect(a).toBe(again as string);
    expect(a).not.toBe(b as string);
  });

  test("ignores a trailing separator and a redundant dot segment", async () => {
    // The operator types one spelling and the workspace picker supplies
    // another; both name the same workspace, so both must reach the same slot.
    const bare = await workspaceServeTokenKey("/home/someone/work/engagement-a");
    expect(await workspaceServeTokenKey("/home/someone/work/engagement-a/")).toBe(bare as string);
    expect(await workspaceServeTokenKey("/home/someone/work/./engagement-a")).toBe(bare as string);
  });

  test("declines to key a path that is not absolute", async () => {
    // Nothing here can resolve a relative path, and guessing at a slot would
    // read someone else's token. The caller falls back to the unkeyed name.
    expect(await workspaceServeTokenKey("work/engagement-a")).toBeNull();
    expect(await workspaceServeTokenKey("   ")).toBeNull();
  });

  test("matches the name agent-fde prints, for a pinned path", async () => {
    // The other half of this contract is agent_fde/mcp/provisioning.py, pinned
    // to the same pair in tests/unit/test_mcp_workspace_token_env_var.py.
    // Nothing links the two at build time: if this value is changed without
    // changing that one, every provisioned workspace stops resolving and the
    // only symptom is a refusal that looks like a bad token.
    expect(await workspaceServeTokenKey("/home/someone/work/engagement-a")).toBe(
      "MCP_SERVE_TOKEN__3251FBD65DA3",
    );
  });

  test("agrees with agent-fde on the cases most likely to diverge", async () => {
    // A UTF-8 path pins the encoding, and "..' pins the decision to leave it
    // uncollapsed -- the two places two independent implementations of "the
    // same" normalisation usually drift apart. Both values were produced by
    // running the Python side, not by reasoning about them.
    expect(await workspaceServeTokenKey("/tmp/Ünïcødé workspace/eng")).toBe(
      "MCP_SERVE_TOKEN__C2371D0E7371",
    );
    expect(await workspaceServeTokenKey("/a/b/c/../..")).toBe("MCP_SERVE_TOKEN__CFC7BEFA3F34");
  });
});
