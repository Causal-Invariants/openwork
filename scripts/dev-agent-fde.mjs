#!/usr/bin/env node
/**
 * Start the OpenWork desktop app in dev mode with an Agent-FDE workspace
 * already mounted, provisioned, and selected.
 *
 * Why this script exists: connecting Agent-FDE by hand is four separate
 * steps in three different places, and getting any one of them wrong fails
 * in a way that still *looks* healthy. In particular, with only
 * MCP_LAUNCH_WORKSPACE set the server starts, `initialize` succeeds and all
 * the view tools list -- and every `tools/call` is refused, because
 * `agent-fde mcp serve|launch` will not mint its own credential. The token
 * has to be issued out of band and handed back through OpenWork's user-level
 * env store. See spikes/openwork-ui/BRINGUP.md in the Agent-FDE repo.
 *
 * What it does, all idempotent:
 *   1. Resolves the workspace under the workspaces base directory
 *      (default: ../openwork-workspaces relative to this repo).
 *   2. `agent-fde init`s it, and on a fresh workspace mints the genesis
 *      authority grant (`stakeholder create` + `stakeholder bootstrap`).
 *   3. Issues an `MCP_SERVE_TOKEN` credential and stores it in OpenWork's
 *      user env store (~/.config/openwork/env.json) under the
 *      workspace-keyed name the app looks up first.
 *   4. Registers the workspace in the desktop workspace store and selects it.
 *   5. Writes the `agent-fde` MCP entry into the workspace's opencode.jsonc.
 *   6. Runs `pnpm dev`.
 *
 * Usage:
 *   pnpm dev:agent-fde [workspace-name] [--workspaces-root DIR]
 *                      [--reissue-token] [--no-launch]
 *
 * Env knobs:
 *   OPENWORK_WORKSPACES_ROOT   base dir for workspaces
 *   OPENWORK_AGENT_FDE_WORKSPACE  default workspace name
 *   AGENT_FDE_BIN              agent-fde binary (default: agent-fde on PATH)
 *   OPENWORK_ENV_STORE         override the user env store path
 *   OPENWORK_ELECTRON_USERDATA override the desktop profile directory
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_FDE = process.env.AGENT_FDE_BIN?.trim() || "agent-fde";
const SERVE_TOKEN_KEY = "MCP_SERVE_TOKEN";
/** Matches apps/app/src/react-app/domains/connections/agent-fde-serve-token.ts. */
const WORKSPACE_KEY_DIGEST_LENGTH = 12;
/** The dev build runs under its own identifier so it can sit beside a release. */
const DEV_APP_IDENTIFIER = "com.differentai.openwork.dev";

function fail(message) {
  console.error(`dev:agent-fde: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { name: "", workspacesRoot: "", reissue: false, launch: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--workspaces-root") {
      options.workspacesRoot = argv[index + 1] ?? "";
      index += 1;
    } else if (argument === "--reissue-token") {
      options.reissue = true;
    } else if (argument === "--no-launch") {
      options.launch = false;
    } else if (argument.startsWith("-")) {
      fail(`unknown option ${argument}`);
    } else if (!options.name) {
      options.name = argument;
    } else {
      fail(`unexpected argument ${argument}`);
    }
  }
  return options;
}

function run(command, args, { input, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", input });
  if (result.error) {
    if (result.error.code === "ENOENT") fail(`${command} is not on PATH`);
    fail(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-3).join("\n");
    fail(`${command} ${args.join(" ")} exited ${result.status}\n${detail}`);
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function fde(workspace, args, options) {
  return run(AGENT_FDE, ["--workspace", workspace, ...args], options);
}

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    // The workspace config is .jsonc; the shapes we touch never carry
    // comments, so a strict parse that skips on failure is safer than a
    // comment stripper that would silently rewrite someone's file.
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/**
 * The env-store slot a workspace's serve token lives in.
 *
 * Ported from agent-fde's `workspace_token_env_var` and mirrored by the app's
 * `workspaceServeTokenEnvVar`; all three must agree on the same string for
 * the same workspace or a provisioned token is invisible to the app. The
 * input is the same absolute path we write into the workspace store, so both
 * sides hash an identical string.
 */
function serveTokenEnvVar(workspaceRoot) {
  const digest = createHash("sha256").update(workspaceRoot).digest("hex");
  return `${SERVE_TOKEN_KEY}__${digest.slice(0, WORKSPACE_KEY_DIGEST_LENGTH).toUpperCase()}`;
}

function configHome() {
  return process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), ".config");
}

function envStorePath() {
  const override = process.env.OPENWORK_ENV_STORE?.trim();
  if (override) return path.resolve(override);
  return path.join(configHome(), "openwork", "env.json");
}

function desktopProfileDir() {
  const override = process.env.OPENWORK_ELECTRON_USERDATA?.trim();
  if (override) return path.resolve(override);
  return path.join(configHome(), DEV_APP_IDENTIFIER);
}

/** Mirrors `stableWorkspaceId` in apps/desktop/electron/workspace-store.mjs. */
function localWorkspaceId(workspacePath) {
  return `ws_${createHash("sha256").update(workspacePath).digest("hex").slice(0, 12)}`;
}

function ensureWorkspace(workspace) {
  mkdirSync(workspace, { recursive: true });
  // `init` is create-or-upgrade, so it is the right call on both a fresh
  // directory and an existing workspace.
  fde(workspace, ["init"]);
}

function credentialsStakeholder(workspace) {
  const credentials = readJson(path.join(workspace, "credentials.json"), null);
  const first = credentials?.credentials?.[0]?.stakeholder;
  return typeof first === "string" && first ? first : null;
}

/**
 * Mint the genesis authority grant on a workspace that has none.
 *
 * A credential bound to a stakeholder no live grant covers is refused at
 * issue time -- it would authenticate and then read nothing -- so this has to
 * happen before `mcp issue-credential`, and only once per workspace.
 */
function bootstrapStakeholder(workspace) {
  const created = fde(workspace, [
    "--json", "stakeholder", "create", "--display-name", "OpenWork operator",
  ]);
  const stakeholderId = JSON.parse(created.stdout).fde_id;
  // The grant is never unbounded; ten years is long enough that a demo
  // workspace does not silently go dark mid-session.
  const expiresAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000)
    .toISOString().replace(/\.\d+Z$/, "+00:00");
  fde(workspace, [
    "--json", "stakeholder", "bootstrap",
    "--founder", `stakeholder:${stakeholderId}`,
    // Workspace-scoped, not engagement-scoped: the launcher mounts the
    // server, it does not seed an engagement. `--engagement` must still be
    // *present and empty* -- omitting it entirely leaves the grant's scope
    // kind at `engagement` with no ref and the call is refused with
    // "scope kind engagement requires a ref".
    "--engagement", "",
    "--action-class", "approve_requirement",
    "--action-class", "approve_authority_grant",
    "--expires-at", expiresAt,
  ]);
  return `fde:stakeholder/${stakeholderId}`;
}

function issueCredential(workspace, stakeholder) {
  const result = run(AGENT_FDE, [
    "mcp", "issue-credential",
    "--workspace", workspace,
    "--subject", "openwork-host",
    "--actor-kind", "human",
    "--display-name", "OpenWork desktop",
    "--stakeholder", stakeholder,
  ], { allowFailure: true });
  if (result.status !== 0) return null;
  // The token is printed to stdout once and only its SHA-256 is stored, so
  // there is no recovery path if this capture is dropped.
  return result.stdout.trim() || null;
}

function ensureServeToken(workspace, { reissue }) {
  const storePath = envStorePath();
  const key = serveTokenEnvVar(workspace);
  const store = readJson(storePath, { schemaVersion: 1, updatedAt: Date.now(), variables: [] });
  if (store === null) fail(`${storePath} is not valid JSON; move it aside and re-run`);
  const variables = Array.isArray(store.variables) ? store.variables : [];
  const existing = variables.find((record) => record?.key === key);
  if (existing && !reissue) return { key, storePath, reused: true };

  let stakeholder = credentialsStakeholder(workspace);
  let token = stakeholder ? issueCredential(workspace, stakeholder) : null;
  if (!token) {
    // Either the workspace has never been provisioned, or its recorded
    // stakeholder no longer holds a live grant. Both are answered by
    // bootstrapping; bootstrap itself refuses if a grant already exists, and
    // that refusal is a real error worth surfacing.
    stakeholder = bootstrapStakeholder(workspace);
    token = issueCredential(workspace, stakeholder);
  }
  if (!token) fail("agent-fde mcp issue-credential produced no token");

  const next = variables.filter((record) => record?.key !== key);
  next.push({ key, value: token, updatedAt: Date.now() });
  writeJson(storePath, { schemaVersion: 1, updatedAt: Date.now(), variables: next });
  return { key, storePath, reused: false, stakeholder };
}

function registerWorkspace(workspace, name) {
  const storePath = path.join(desktopProfileDir(), "openwork-workspaces.json");
  const store = readJson(storePath, { workspaces: [] });
  if (store === null) fail(`${storePath} is not valid JSON; move it aside and re-run`);
  const id = localWorkspaceId(workspace);
  const workspaces = Array.isArray(store.workspaces) ? store.workspaces : [];
  const entry = {
    id,
    name,
    path: workspace,
    preset: "starter",
    workspaceType: "local",
    remoteType: null,
    baseUrl: null,
    directory: null,
    displayName: null,
    openworkHostUrl: null,
    openworkToken: null,
    openworkClientToken: null,
    openworkHostToken: null,
    openworkWorkspaceId: null,
    openworkWorkspaceName: null,
    sandboxBackend: null,
    sandboxRunId: null,
    sandboxContainerName: null,
  };
  // A workspace is keyed by path, so an entry with the same name at a
  // different path is a distinct workspace that renders identically in the
  // picker -- worth saying out loud rather than leaving the user to guess
  // which of two "gui-ws" rows is the one this run provisioned.
  for (const candidate of workspaces) {
    if (candidate?.name === name && candidate?.path !== workspace) {
      console.warn(`dev:agent-fde: note: another workspace is also named ${name} (${candidate.path})`);
    }
  }
  const existingIndex = workspaces.findIndex((candidate) => candidate?.id === id);
  if (existingIndex >= 0) workspaces[existingIndex] = { ...workspaces[existingIndex], ...entry };
  else workspaces.push(entry);
  writeJson(storePath, {
    ...store,
    workspaces,
    selectedId: id,
    watchedId: id,
    activeId: id,
    selectedWorkspaceId: id,
    watchedWorkspaceId: id,
  });
  return { id, storePath };
}

/**
 * Write the `agent-fde` entry into the workspace's own opencode config.
 *
 * This is the second, independent route to a mounted server: OpenWork's
 * "Connect" button registers it in the app's server state instead and does
 * not rewrite this file. Having both means the workspace comes up mounted
 * without a click, and the entry carries `environment` explicitly because a
 * command with no MCP_LAUNCH_WORKSPACE exits immediately.
 */
function writeWorkspaceMcpConfig(workspace, token) {
  const configPath = path.join(workspace, "opencode.jsonc");
  const config = readJson(configPath, { $schema: "https://opencode.ai/config.json" });
  if (config === null) {
    console.warn(`dev:agent-fde: skipped ${configPath} (not plain JSON; leaving it untouched)`);
    return null;
  }
  const environment = { MCP_LAUNCH_WORKSPACE: workspace };
  if (token) environment[SERVE_TOKEN_KEY] = token;
  config.mcp = {
    ...(config.mcp ?? {}),
    "agent-fde": { type: "local", enabled: true, command: ["agent-fde", "mcp", "launch"], environment },
  };
  writeJson(configPath, config);
  return configPath;
}

function readStoredToken(key) {
  const store = readJson(envStorePath(), null);
  return store?.variables?.find((record) => record?.key === key)?.value ?? null;
}

const options = parseArgs(process.argv.slice(2));
const name = options.name || process.env.OPENWORK_AGENT_FDE_WORKSPACE?.trim() || "gui-ws";
if (name.includes("/") || name.includes("..")) fail(`workspace name ${name} must be a single directory name`);
const workspacesRoot = path.resolve(
  options.workspacesRoot || process.env.OPENWORK_WORKSPACES_ROOT?.trim() || path.join(REPO_ROOT, "..", "openwork-workspaces"),
);
const workspace = path.join(workspacesRoot, name);

console.log(`dev:agent-fde: workspace ${workspace}`);
ensureWorkspace(workspace);
const serveToken = ensureServeToken(workspace, { reissue: options.reissue });
console.log(`dev:agent-fde: serve token ${serveToken.reused ? "reused" : "issued"} as ${serveToken.key} in ${serveToken.storePath}`);
const registered = registerWorkspace(workspace, name);
console.log(`dev:agent-fde: registered and selected ${registered.id} in ${registered.storePath}`);
const configPath = writeWorkspaceMcpConfig(workspace, readStoredToken(serveToken.key));
if (configPath) console.log(`dev:agent-fde: wrote the agent-fde MCP entry to ${configPath}`);

if (!options.launch) {
  console.log("dev:agent-fde: --no-launch, so not starting the app");
  process.exit(0);
}
console.log("dev:agent-fde: starting the desktop app (pnpm dev)");
const child = spawn("pnpm", ["dev"], { cwd: REPO_ROOT, stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
