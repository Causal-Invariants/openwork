import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { DynamicToolUIPart } from "ai"

import { Tool } from "../src/components/ui/tool"

test("renders compact MCP attribution in a failed chat tool row", () => {
  const toolPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "openwork-cloud_execute_capability",
    toolCallId: "call-1",
    state: "output-error",
    input: {},
    errorText: JSON.stringify({
      error: "connection_failed",
      diagnostic: { code: "MCP_HTTP_504", httpStatus: 504 },
    }),
  }

  const html = renderToStaticMarkup(<Tool toolPart={toolPart} />)

  expect(html).toContain("Remote MCP · HTTP 504")
  expect(html).toContain("Error attribution: Remote MCP · HTTP 504. Confirmed.")
  expect(html).not.toContain(">failed<")
})

test("renders an inline reconnect button when Cloud capability discovery finds expired credentials", () => {
  const toolPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "openwork-cloud_search_capabilities",
    toolCallId: "call-reconnect",
    state: "output-available",
    input: {},
    output: JSON.stringify({
      matches: [{
        kind: "connection_status",
        connectionStatus: {
          version: 1,
          kind: "connection_action",
          source: "openwork-cloud",
          connectionId: "emc_knowledge",
          connectionName: "Knowledge Hub",
          authType: "oauth",
          credentialMode: "per_member",
          state: "reauth_required",
          actor: "member",
          action: {
            type: "reconnect",
            surface: "openwork_your_connections",
            retry: "search_capabilities",
          },
        },
      }],
    }),
  }

  const html = renderToStaticMarkup(
    <Tool toolPart={toolPart} onReconnect={async () => "connected"} />,
  )

  expect(html).toContain("Reconnect required")
  expect(html).toContain('aria-label="Reconnect Knowledge Hub"')
  expect(html).toContain("Reconnect</button>")
  expect(html).toContain("bg-amber-3/60")
  expect(html).toContain('data-testid="chat-mcp-reconnect-action"')
})

test("renders a copy action inside the expanded tool result", () => {
  const toolPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "openwork-cloud_search_capabilities",
    toolCallId: "call-copy",
    state: "output-available",
    input: { query: "Notion pages" },
    output: { matches: [{ name: "searchPages" }] },
  }

  const html = renderToStaticMarkup(<Tool toolPart={toolPart} defaultOpen />)
  const contentIndex = html.indexOf('data-slot="collapsible-content"')
  const copyActionIndex = html.indexOf('data-testid="tool-result-copy-action"')

  expect(contentIndex).toBeGreaterThan(-1)
  expect(copyActionIndex).toBeGreaterThan(contentIndex)
  expect(html).toContain('aria-label="Copy tool result"')
})

test("does not render a copy action before a tool has a result", () => {
  const toolPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "openwork-cloud_search_capabilities",
    toolCallId: "call-running",
    state: "input-available",
    input: { query: "Notion pages" },
  }

  const html = renderToStaticMarkup(<Tool toolPart={toolPart} />)

  expect(html).not.toContain('data-testid="tool-result-copy-action"')
})

const AUTHORITY_REFUSAL_ERROR = JSON.stringify({
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

const CEILING_REFUSAL_ERROR = JSON.stringify({
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

function refusedToolPart(errorText: string): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolName: "agent-fde_raise-risk",
    toolCallId: "call-refused",
    state: "output-error",
    input: {},
    errorText,
  }
}

test("renders the grant a refused Agent-FDE call is asking for", () => {
  const html = renderToStaticMarkup(<Tool toolPart={refusedToolPart(AUTHORITY_REFUSAL_ERROR)} defaultOpen />)

  expect(html).toContain("Authority required")
  expect(html).toContain("Request this grant")
  expect(html).toContain("agent-fde stakeholder grant")
  expect(html).toContain("--engagement 01J8Z000000000000000ENGAGE")
  expect(html).toContain("--action-class raise_risk")
})

test("tells the reader a grant will not lift a ceiling, and offers no command", () => {
  const html = renderToStaticMarkup(<Tool toolPart={refusedToolPart(CEILING_REFUSAL_ERROR)} defaultOpen />)

  expect(html).toContain("Authority ceiling")
  expect(html).toContain("Capped by a policy ceiling")
  expect(html).toContain("will not lift it")
  // The whole point: no remedy is offered that cannot work.
  expect(html).not.toContain("agent-fde stakeholder grant")
})
