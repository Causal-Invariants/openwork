import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server"
import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { skillCreatedAppHtml } from "@openwork/mcp-apps/skill-created"
import {
  skillCreatedAppSchemaVersion,
  skillCreatedPayloadSchema,
  type SkillCreatedPayload,
} from "@openwork/types/skill-created-app"
import { z } from "zod"

export { skillCreatedPayloadSchema } from "@openwork/types/skill-created-app"

export const SKILL_CREATED_APP_RESOURCE_URI = "ui://openwork/skill-created/v1/view.html"
export const CREATE_SKILL_TOOL_NAME = "create_skill"
export const SKILL_CREATED_APP_HTML = skillCreatedAppHtml

export type CreateSkillResult =
  | { ok: true; payload: SkillCreatedPayload }
  | { ok: false; error: string; message: string }

const skillCreatedAppResourceMeta: { ui: McpUiResourceMeta } = {
  ui: {
    csp: {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
      baseUriDomains: [],
    },
    prefersBorder: true,
  },
}

export function skillCreatedTextFallback(payload: SkillCreatedPayload): string {
  return [
    `# Skill created: ${payload.name}`,
    payload.description,
    `Plugin ID: ${payload.pluginId}`,
    `Skill ID: ${payload.skillId}`,
    payload.libraryUrl ? `Library: ${payload.libraryUrl}` : null,
  ].filter((line): line is string => line !== null).join("\n")
}

export function registerAgentSkillCreatedApp(input: {
  server: McpServer
  create: (request: { pluginName: string; skillMarkdown: string }) => Promise<CreateSkillResult>
}) {
  registerAgentSkillCreatedResource(input.server)
  registerAppTool(
    input.server,
    CREATE_SKILL_TOOL_NAME,
    {
      title: "Create skill",
      description: [
        "Create one private OpenWork Cloud skill in a new Plugin.",
        "Pass a complete SKILL.md with valid frontmatter and instructions.",
        "The skill is immediately available to its creator; this does not publish it to a Marketplace or share it.",
        "Clients without MCP Apps support receive a text confirmation.",
      ].join(" "),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: z.object({
        pluginName: z.string().trim().min(1).max(255).describe("Display name for the new Plugin."),
        skillMarkdown: z.string().trim().min(1).max(1_048_576).describe("Complete SKILL.md source, including frontmatter and instructions."),
      }),
      outputSchema: skillCreatedPayloadSchema,
      _meta: {
        ui: {
          resourceUri: SKILL_CREATED_APP_RESOURCE_URI,
          visibility: ["model", "app"],
        },
      },
    },
    async ({ pluginName, skillMarkdown }) => {
      const result = await input.create({ pluginName, skillMarkdown })
      if (!result.ok) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: result.error, message: result.message }),
          }],
        }
      }
      return {
        content: [{ type: "text" as const, text: skillCreatedTextFallback(result.payload) }],
        structuredContent: result.payload,
        _meta: {
          schemaVersion: skillCreatedAppSchemaVersion,
          pluginId: result.payload.pluginId,
          skillId: result.payload.skillId,
        },
      }
    },
  )
}

export function registerAgentSkillCreatedResource(server: McpServer) {
  registerAppResource(
    server,
    "OpenWork Skill Created",
    SKILL_CREATED_APP_RESOURCE_URI,
    {
      description: "A compact confirmation for a newly created OpenWork Cloud skill.",
      _meta: skillCreatedAppResourceMeta,
    },
    async () => ({
      contents: [{
        uri: SKILL_CREATED_APP_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: SKILL_CREATED_APP_HTML,
        _meta: skillCreatedAppResourceMeta,
      }],
    }),
  )
}
