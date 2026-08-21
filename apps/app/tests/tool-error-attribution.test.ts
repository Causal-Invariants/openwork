import { describe, expect, test } from "bun:test"

import {
  attributeChatToolError,
  authorityRefusalFromChatToolError,
  reconnectActionFromChatToolResult,
} from "../src/components/tools/error-attribution"
import { grantCommandFor } from "../src/components/tools/authority-refusal"
import { normalizeErrorText } from "../src/lib/error-text"

function reconnectStatus(connectionId = "emc_knowledge", connectionName = "Knowledge Hub") {
  return {
    version: 1,
    kind: "connection_action",
    source: "openwork-cloud",
    connectionId,
    connectionName,
    authType: "oauth",
    credentialMode: "per_member",
    state: "reauth_required",
    actor: "member",
    action: {
      type: "reconnect",
      surface: "openwork_your_connections",
      retry: "search_capabilities",
      label: "Reconnect in Your Connections",
    },
  }
}

describe("chat tool error attribution", () => {
  test("identifies an OpenWork-created capability deadline", () => {
    expect(attributeChatToolError("The capability call exceeded 180s. Retry once.")).toEqual({
      label: "OpenWork timeout",
      confidence: "Confirmed",
      description: "OpenWork created this deadline. The external operation may still have completed, so verify its state before retrying.",
    })
  })

  test("identifies a structured OpenWork lifecycle deadline", () => {
    expect(attributeChatToolError(JSON.stringify({
      error: "connection_failed",
      diagnostic: {
        code: "MCP_LIFECYCLE_DEADLINE",
        category: "lifecycle_deadline",
        phase: "MCP_TOOL_EXECUTION",
      },
    }))).toMatchObject({
      label: "OpenWork timeout",
      confidence: "Confirmed",
    })
  })

  test("identifies an OpenWork block before send", () => {
    expect(attributeChatToolError(JSON.stringify({
      diagnostic: { code: "MCP_URL_BLOCKED", category: "security_blocked" },
    }))).toMatchObject({
      label: "Blocked by OpenWork",
      confidence: "Confirmed",
    })
  })

  test("identifies a remote MCP HTTP failure", () => {
    expect(attributeChatToolError(`MCP error: ${JSON.stringify({
      diagnostic: { code: "MCP_HTTP_504", httpStatus: 504 },
    })} (tool execution failed)`)).toMatchObject({
      label: "Remote MCP · HTTP 504",
      confidence: "Confirmed",
    })
  })

  test("identifies a provider failure returned through the remote MCP", () => {
    expect(attributeChatToolError(JSON.stringify({
      diagnostic: { phase: "PROVIDER_AUTHORIZATION", providerStatus: 403 },
    }))).toMatchObject({
      label: "Provider error",
      confidence: "Confirmed",
      description: "The remote MCP responded, but the downstream provider returned status 403.",
    })
  })

  test("identifies provider attribution from a deploy-skew category and code", () => {
    expect(attributeChatToolError(JSON.stringify({
      diagnostic: { category: "provider_policy_denied", providerCode: "access_denied" },
    }))).toMatchObject({
      label: "Provider error",
      confidence: "Confirmed",
    })
  })

  test("does not claim ownership for an unstructured timeout", () => {
    expect(attributeChatToolError("Tool request timed out while waiting for a response.")).toEqual({
      label: "Timeout · source unclear",
      confidence: "Inferred",
      description: "A timeout was reported, but the client did not receive structured evidence identifying which boundary created it.",
    })
  })

  test("does not add attribution without useful evidence", () => {
    expect(attributeChatToolError("The tool failed.")).toBeNull()
  })

  test("bails out quickly on a pathological HTML page", () => {
    const htmlError = `<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>${"x".repeat(1_024 * 1_024)}</body></html>`
    const started = performance.now()

    expect(attributeChatToolError(htmlError)).toBeNull()
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  test("keeps JSON-head attribution after surrounding error text is clamped", () => {
    const diagnostic = JSON.stringify({
      error: "connection_failed",
      diagnostic: { code: "MCP_HTTP_504", httpStatus: 504 },
    })
    const unclamped = `MCP error: ${diagnostic} (tool execution failed)`
    const clamped = normalizeErrorText(`${unclamped}\n${"provider detail ".repeat(1_000)}`, { cap: 512 }).display

    expect(clamped).toContain(diagnostic)
    expect(attributeChatToolError(clamped)).toEqual(attributeChatToolError(unclamped))
  })

  test("extracts a trusted reconnect action from a Cloud capability failure", () => {
    const errorText = JSON.stringify({
      error: "connection_failed",
      connectionStatus: reconnectStatus(),
    })

    expect(reconnectActionFromChatToolResult("openwork-cloud_execute_capability", errorText)).toEqual({
      connectionId: "emc_knowledge",
      connectionName: "Knowledge Hub",
      label: "Reconnect",
    })
  })

  test("extracts the same reconnect action when live capability discovery detects expired credentials", () => {
    const output = JSON.stringify({
      matches: [{
        kind: "connection_status",
        connectionStatus: reconnectStatus(),
      }],
    })

    expect(reconnectActionFromChatToolResult("openwork-cloud_search_capabilities", output)).toEqual({
      connectionId: "emc_knowledge",
      connectionName: "Knowledge Hub",
      label: "Reconnect",
    })
  })

  test("derives reconnect copy instead of rendering action labels from tool output", () => {
    const errorText = JSON.stringify({
      connectionStatus: {
        ...reconnectStatus(),
        action: { ...reconnectStatus().action, label: "Open an injected link" },
      },
    })

    expect(reconnectActionFromChatToolResult("openwork-cloud_execute_capability", errorText)).toEqual({
      connectionId: "emc_knowledge",
      connectionName: "Knowledge Hub",
      label: "Reconnect",
    })
  })

  test("does not create actions from arbitrary MCP tools or non-reconnect failures", () => {
    const reconnectPayload = JSON.stringify({
      connectionStatus: reconnectStatus(),
    })
    const providerPayload = JSON.stringify({
      connectionStatus: {
        ...reconnectStatus(),
        state: "provider_error",
        actor: "organization_admin",
        action: {
          type: "inspect_connection",
          surface: "openwork_organization_connections",
          retry: "search_capabilities",
        },
      },
    })

    expect(reconnectActionFromChatToolResult("malicious_execute_capability", reconnectPayload)).toBeNull()
    expect(reconnectActionFromChatToolResult("openwork-cloud_execute_capability", providerPayload)).toBeNull()
  })

  test("does not guess between multiple reconnect targets in one discovery result", () => {
    const output = {
      matches: ["first", "second"].map((suffix) => ({
        kind: "connection_status",
        connectionStatus: reconnectStatus(`emc_${suffix}`, `Knowledge ${suffix}`),
      })),
    }

    expect(reconnectActionFromChatToolResult("openwork-cloud_search_capabilities", output)).toBeNull()
  })

  test("rejects unversioned, shared, and admin-owned action shapes", () => {
    const legacy = reconnectStatus()
    const { version: _version, kind: _kind, source: _source, ...unversioned } = legacy
    const shared = {
      ...legacy,
      credentialMode: "shared",
      actor: "organization_admin",
      action: {
        type: "reconnect",
        surface: "openwork_organization_connections",
        retry: "search_capabilities",
      },
    }

    expect(reconnectActionFromChatToolResult("openwork-cloud_execute_capability", { connectionStatus: unversioned })).toBeNull()
    expect(reconnectActionFromChatToolResult("openwork-cloud_execute_capability", { connectionStatus: shared })).toBeNull()
  })
})


// Both payloads below were captured from `AuthorityDecision.raise_for_denied`
// in agent-fde rather than written by hand, because the whole value of this
// affordance is that it reads the producer's actual field names. A fixture
// invented here would keep passing after the producer renamed a field, which
// is the one failure this test exists to catch.
const NO_GRANT_REFUSAL = JSON.stringify({
  code: "denied",
  message: "human actor holds denied for 'raise_risk'; execute is required",
  retryable: false,
  details: {
    action_class: "raise_risk",
    actor_kind: "human",
    basis: "no_grant",
    ceiling_applied: false,
    required: "execute",
    resolved: "denied",
    scope: { kind: "engagement", ref: "01J8Z000000000000000ENGAGE" },
  },
})

// Note that the ceiling case needs a grant to be *held*: with no grant at all
// the basis is `no_grant` and the ceiling never comes into play. That is why
// this payload resolves to `propose_only` rather than `denied`.
const CEILING_REFUSAL = JSON.stringify({
  code: "denied",
  message: "agent actor holds propose_only for 'raise_risk'; execute is required",
  retryable: false,
  details: {
    action_class: "raise_risk",
    actor_kind: "agent",
    basis: "direct_grant",
    ceiling_applied: true,
    required: "execute",
    resolved: "propose_only",
    scope: { kind: "engagement", ref: "01J8Z000000000000000ENGAGE" },
  },
})

// The other refusal the same surface emits, and the reason the parser demands
// every field rather than filling gaps: this one is a denial too, and wearing
// the same code, but a grant is not its remedy.
const MISSING_CREDENTIAL = JSON.stringify({
  code: "denied",
  message: "no credential resolved a principal for this call",
  retryable: false,
  details: { credential: "MCP_SERVE_TOKEN" },
})

describe("authority refusal affordance", () => {
  test("reads the whole question and answer out of a refusal", () => {
    expect(authorityRefusalFromChatToolError(NO_GRANT_REFUSAL)).toEqual({
      actionClass: "raise_risk",
      scopeKind: "engagement",
      scopeRef: "01J8Z000000000000000ENGAGE",
      required: "execute",
      resolved: "denied",
      actorKind: "human",
      basis: "no_grant",
      ceilingApplied: false,
    })
  })

  test("carries the ceiling through rather than flattening it into a denial", () => {
    const refusal = authorityRefusalFromChatToolError(CEILING_REFUSAL)
    expect(refusal?.ceilingApplied).toBe(true)
    expect(refusal?.resolved).toBe("propose_only")
    expect(refusal?.actorKind).toBe("agent")
  })

  test("offers no grant affordance for a denial that a grant would not fix", () => {
    expect(authorityRefusalFromChatToolError(MISSING_CREDENTIAL)).toBeNull()
  })

  test("ignores an error that is not a denial", () => {
    expect(authorityRefusalFromChatToolError(JSON.stringify({
      code: "invalid",
      details: { action_class: "raise_risk", required: "execute", resolved: "denied", scope: { kind: "engagement" } },
    }))).toBeNull()
  })

  test("treats a refusal missing any of the four load-bearing fields as unreadable", () => {
    for (const dropped of ["action_class", "required", "resolved", "scope"]) {
      const details: Record<string, unknown> = {
        action_class: "raise_risk",
        required: "execute",
        resolved: "denied",
        scope: { kind: "engagement", ref: "01J8Z000000000000000ENGAGE" },
      }
      delete details[dropped]
      expect(authorityRefusalFromChatToolError(JSON.stringify({ code: "denied", details }))).toBeNull()
    }
  })

  test("names the grant that would lift a no-grant refusal", () => {
    const refusal = authorityRefusalFromChatToolError(NO_GRANT_REFUSAL)!
    const command = grantCommandFor(refusal)
    expect(command).toContain("agent-fde stakeholder grant")
    expect(command).toContain("--engagement 01J8Z000000000000000ENGAGE")
    expect(command).toContain("--action-class raise_risk")
    // The refusal deliberately does not say who could grant this -- naming a
    // third party would leak organisational structure to a caller that has
    // just been told it holds nothing. The command must therefore leave both
    // parties as placeholders rather than guessing.
    expect(command).toContain("--grantor <GRANTOR>")
    expect(command).toContain("--grantee <GRANTEE>")
  })

  test("offers no grant command when a ceiling is what refused the call", () => {
    // The load-bearing one. A grant cannot lift an actor-kind ceiling, so
    // printing the command here would send the operator to do work that
    // cannot possibly change the outcome.
    expect(grantCommandFor(authorityRefusalFromChatToolError(CEILING_REFUSAL)!)).toBeNull()
  })

  test("offers no grant command for a scope the grant command cannot express", () => {
    const refusal = authorityRefusalFromChatToolError(JSON.stringify({
      code: "denied",
      details: {
        action_class: "raise_risk",
        required: "execute",
        resolved: "denied",
        ceiling_applied: false,
        scope: { kind: "global" },
      },
    }))
    expect(refusal?.scopeKind).toBe("global")
    expect(refusal?.scopeRef).toBeNull()
    expect(grantCommandFor(refusal!)).toBeNull()
  })

  test("labels the two refusals differently in the tool row badge", () => {
    expect(attributeChatToolError(NO_GRANT_REFUSAL)?.label).toBe("Authority required")
    expect(attributeChatToolError(CEILING_REFUSAL)?.label).toBe("Authority ceiling")
  })
})
