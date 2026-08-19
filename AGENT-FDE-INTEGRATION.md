# Agent-FDE as an OpenWork extension — Lane 3

## What was declared

Added an entry to `BUILT_IN_OPENWORK_EXTENSION_MANIFESTS` in
`apps/app/src/app/extensions.ts` (`id: "agent-fde"`), with a single resource:

```ts
{
  type: "mcp",
  id: "agent-fde-mcp",
  label: "Agent-FDE MCP",
  description: "Spawned locally over stdio: agent-fde mcp serve --workspace <path>",
  mcpServerName: "agent-fde",
  command: ["agent-fde", "mcp", "serve", "--workspace", "<path>"],
  required: true,
}
```

Resource id (`agent-fde-mcp`) and invocation
(`agent-fde mcp serve --workspace <path>`, stdio) match the shared contract
fixed with Lane 1's server work.

## Resource type: `mcp`, not `local-service`

`spikes/openwork-ui/RECOMMENDATIONS.md` §5 said this would ship as a
`local-service` resource. Reading `extensions.ts` and its two `local-service`
precedents shows that's the wrong type for what Agent-FDE actually is:

- `openwork-voice-realtime-session` (`local-service`, ~L252): no `command`,
  no `mcpServerName` — it's a description-only stand-in for a capability
  implemented by a `server-route` contribution against OpenWork's own
  backend, not a spawned external process.
- `ollama-api` (`local-service`, ~L283): no `command` either — it's an
  always-on HTTP endpoint at a fixed URL (`http://localhost:11434`) that
  OpenWork talks to, not something OpenWork spawns.
- `computer-use-mcp` (`type: "mcp"`, ~L203): has `command: [...]` and
  `mcpServerName`, and is exactly what OpenWork spawns locally as a stdio MCP
  server, per `mcp-view.tsx` (`entry.command` / `computerUseMcpCommand`
  resolution at line ~686).

Agent-FDE is a spawned stdio MCP process (Lane 1's contract), not a
pre-existing endpoint or an internal server-route capability — that's the
`computer-use-mcp` shape, not the `local-service` shape. So the resource type
here is `"mcp"`. The `OpenWorkExtensionResourceType` union does list a
`local-service` variant, and the lane brief's framing ("declare as a
local-service extension") used that name loosely for "a service that runs
locally"; the schema's own type for "locally-spawned MCP server" is `mcp`,
and I followed the schema over the framing. This is worth Lane 1/coordinator
awareness since it changes the field shape (`command`/`mcpServerName` present,
no `path`).

## Contributions: none declared

`extensions.ts`'s contribution `ref` values are documented as resolving
against components compiled into `apps/app`. I checked every contribution
type actually used by the four existing built-in manifests against the rest
of the `apps/app` source tree:

- **`settings-panel`**: resolves through a real registry —
  `apps/app/src/react-app/domains/settings/extension-registry.tsx`
  (`registerExtensionConfig` / `getExtensionConfigSlot`), keyed by the
  contribution's `ref`. Only five ids are registered there (browser, voice,
  ollama, computer-use, openai-image-gen), none for Agent-FDE. Declaring a
  `settings-panel` ref for Agent-FDE without a matching
  `registerExtensionConfig("agent-fde.*", ...)` call would be exactly the
  invented, unresolved contribution the brief said not to add — and adding
  that call means writing a new file under
  `apps/app/src/react-app/domains/settings/`, i.e. a fork.
- **`session-side-panel`, `session-rail-item`**: referenced by ref string
  only in `composer.tsx` (`isComposerExtensionAvailable`, ~L47) and
  `mcp-view.tsx` (`extensionContributionLabels`, ~L290) for boolean
  "does a session surface exist" checks and label display. Grepping the
  existing refs (`openwork.voice.panel`, `openwork.voice.rail`,
  `openwork.browser.panel`) elsewhere in `apps/app/src` finds **no
  consumer that renders a component for those refs at this commit**. There
  is no allowlist to add Agent-FDE's ref to.
- **`control-actions`, `server-route`, `native-capability`, `test-action`,
  `setup-instructions`**: parsed by `apps/app/src/app/lib/den.ts` (external
  manifest ingestion) but not consumed by any ref-lookup elsewhere in
  `apps/app/src` for the four built-in manifests either.
- **`composer-prompt`**: the one contribution type that is genuinely
  self-contained — its `prompt` string is read directly
  (`apps/app/src/app/constants.ts:80`,
  `extensionContribution(manifest, "composer-prompt")?.prompt ?? manifest.composer?.prompt`)
  with no compiled-component ref lookup. This one does resolve, so it is
  the only contribution declared for Agent-FDE (mirrors the top-level
  `composer.prompt` field, same convention as the browser/voice/ollama
  entries).

So the Agent-FDE entry declares one resource (`mcp`) and one contribution
(`composer-prompt`). No `settings-panel`, no session surfaces — those would
need new compiled components in `apps/app` to mean anything, which is exactly
the fork this lane was testing for.

## Does "no fork needed" hold?

Yes, for what was actually required: the manifest entry that makes Agent-FDE
discoverable as a local MCP server is pure data in `extensions.ts`, requiring
no changes anywhere else in `apps/app`. `RECOMMENDATIONS.md` §5's bottom-line
conclusion ("an MCP server for Agent-FDE needs no fork") holds. Its specific
claim that it "ships as a `local-service` resource" does not — see above.

If OpenWork later wants a settings panel, session panel, or rail item that
does something for Agent-FDE specifically (not just "connected: yes/no"),
that genuinely requires a fork (a new file under
`apps/app/src/react-app/domains/settings/` or `.../session/`, registered
into `extension-registry.tsx` or wherever the session-surface resolution
eventually lives). None of that was needed for this lane's task.

## Verified

- `pnpm install --frozen-lockfile` at repo root: succeeded.
- `pnpm --filter @openwork/app typecheck` (`tsc -p tsconfig.json --noEmit`):
  passes clean, no errors, after the `extensions.ts` edit.
- No lint script exists in this monorepo (checked root `package.json` and
  `apps/app/package.json` scripts, no `eslintrc`/`eslint.config`/`biome.json`
  found) — typecheck is the applicable static check for this change and it
  passed.
- Schema validity: the added object satisfies `OpenWorkExtensionManifest`
  and its nested types as defined in `extensions.ts` itself (confirmed by
  typecheck passing — the array is typed as
  `OpenWorkExtensionManifest[]`).

## Unverified

- **Live MCP discovery/connection.** Lane 1's `agent-fde mcp serve` server
  does not exist yet (built in parallel). This entry has not been, and
  cannot yet be, exercised against a real spawn — `mcp-connected` enablement,
  actual stdio handshake, and tool listing are all unverified.
- **The `<path>` placeholder in `command`.** The contract string
  `agent-fde mcp serve --workspace <path>` was given as fixed and is declared
  literally. Nothing found in `apps/app` templates workspace paths into a
  static `command` array at declare-time (`den.ts`'s `parseExtensionResource`
  parses `command` as a flat string list, no substitution). Whatever
  resolves `<path>` to a real workspace directory at spawn time is presumably
  Lane 1/server-side wiring, not something in this manifest file — flagging
  this as an open seam between the two lanes rather than silently guessing
  at a resolution mechanism.
- No end-to-end OpenWork app run (dev server, Electron shell) was performed;
  only `pnpm install` and `pnpm typecheck` were run.
