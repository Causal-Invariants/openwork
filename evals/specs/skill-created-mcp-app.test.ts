import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { expect } from "vitest"
import { test } from "@openwork/testkit"

const repoRoot = resolve(import.meta.dirname, "../..")

test("create_skill publishes a standard MCP App contract and text fallback", ({ evidence }) => {
  const build = spawnSync("pnpm", ["--filter", "@openwork-ee/den-api", "run", "build:mcp-apps"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  })
  const buildOutput = `${build.stdout}${build.stderr}`
  expect(build.error, buildOutput).toBeUndefined()
  expect(build.status, buildOutput).toBe(0)

  const gateway = spawnSync("pnpm", [
    "--filter",
    "@openwork-ee/den-api",
    "exec",
    "bun",
    "test",
    "test/mcp-skill-created-app.test.ts",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  })
  const gatewayOutput = `${gateway.stdout}${gateway.stderr}`
  expect(gateway.error, gatewayOutput).toBeUndefined()
  expect(gateway.status, gatewayOutput).toBe(0)
  expect(gatewayOutput).toContain("3 pass")
  expect(gatewayOutput).toContain("0 fail")

  evidence.recordAssertionEvidence(
    "create_skill is a standard MCP App tool",
    "The gateway lists one create_skill tool with ui://openwork/skill-created/v1/view.html, model/app visibility, compatibility metadata, and a CSP-closed text/html;profile=mcp-app resource.",
    true,
  )
  evidence.recordAssertionEvidence(
    "Skill creation has structured and non-App results",
    "The same call returns payload-schema-valid structuredContent, stable Plugin and skill identifiers, and a useful text fallback without tomato emoji Markdown.",
    true,
  )
})
