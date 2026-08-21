import assert from "node:assert/strict"
import test from "node:test"

import {
  classifyAutomationExecutionError,
  createDesktopAutomationRunner,
  executeDesktopAutomation,
  normalizeRunnerBaseUrl,
  runnerTokenAudience,
} from "./automation-runner.mjs"

function runnerTokenFor(audience, organizationId = "org-1") {
  const payload = Buffer.from(JSON.stringify({
    v: 2,
    o: organizationId,
    m: "member-1",
    r: "runner-1",
    a: audience,
  })).toString("base64url")
  return `${payload}.test-signature`
}

function legacyRunnerToken() {
  const payload = Buffer.from(JSON.stringify({ v: 1, o: "org", m: "member", r: "runner" })).toString("base64url")
  return `${payload}.test-signature`
}

const EXPECTED_RECONNECT_DELAYS = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000]

async function observeHttpFailureBackoff(status) {
  const paths = []
  const delays = []
  const done = new AbortController()
  let runner = null
  runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url) => {
      paths.push(new URL(url).pathname)
      return Response.json({ message: "injected HTTP failure" }, { status })
    },
    random: () => 0.5,
    waitBeforeReconnect: async (ms) => {
      delays.push(ms)
      await new Promise((resolve) => setImmediate(resolve))
      if (delays.length === EXPECTED_RECONNECT_DELAYS.length) {
        runner.stop()
        done.abort()
      }
    },
  })
  runner.configure({
    baseUrl: "https://den.example.com",
    token: runnerTokenFor("https://den.example.com"),
    runnerId: "runner-1",
  })
  if (!done.signal.aborted) {
    await new Promise((resolve) => done.signal.addEventListener("abort", resolve, { once: true }))
  }
  return { paths, delays }
}

async function flushTasks() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function withTimeout(promise, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), 1_000)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

async function observeCredentialRejection(status, deniedRequest) {
  const paths = []
  const delays = []
  const rejections = []
  let resolveRejected
  const rejected = new Promise((resolve) => { resolveRejected = resolve })
  const runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname
      paths.push(path)
      if (path === deniedRequest) {
        return Response.json({ message: "invalid runner credential" }, { status })
      }
      if (path === "/v1/automation-runner/work") return Response.json({ items: [] })
      return new Promise((resolve, reject) => {
        const abort = () => reject(options.signal?.reason ?? new Error("aborted"))
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener("abort", abort, { once: true })
      })
    },
    waitBeforeReconnect: async (ms, signal) => {
      delays.push(ms)
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    },
    onCredentialRejected: () => {
      rejections.push(status)
      resolveRejected()
    },
  })
  const configuration = {
    baseUrl: "https://den.example.com",
    token: runnerTokenFor("https://den.example.com"),
    runnerId: "runner-1",
  }
  runner.configure(configuration)
  await withTimeout(rejected, "credential rejection timed out")
  await flushTasks()
  for (let index = 0; index < 20; index += 1) runner.configure(configuration)
  await flushTasks()
  runner.stop()
  return { paths, delays, rejections }
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1_000
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve))
  assert.ok(predicate(), message)
}

function testAssignment() {
  return {
    executionTarget: "desktop",
    runId: "run-1",
    automationId: "automation-1",
    automationName: "Daily brief",
    instructions: "Prepare the brief",
    model: { providerId: "opencode", modelId: "big-pickle" },
    timeoutMs: 30_000,
    leaseExpiresAt: Date.now() + 60_000,
    attempt: 1,
  }
}

async function observeAssignmentCredentialRejection(status, deniedRoute) {
  const denRequests = []
  let workRequests = 0
  let snapshotStarted = false
  let resolveRejected
  const rejected = new Promise((resolve) => { resolveRejected = resolve })
  const runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url)
      if (parsed.origin === "http://127.0.0.1:3000") {
        if (parsed.pathname === "/workspaces") {
          return Response.json({ items: [{ id: "workspace-1" }], activeId: "workspace-1" })
        }
        if (parsed.pathname === "/workspace/workspace-1/sessions" && options.method === "POST") {
          return Response.json({ item: { id: "session-1" } }, { status: 201 })
        }
        if (parsed.pathname === "/workspace/workspace-1/sessions/session-1/snapshot") {
          snapshotStarted = true
          if (deniedRoute === "heartbeat") {
            return new Promise((resolve, reject) => {
              const abort = () => reject(options.signal?.reason ?? new Error("aborted"))
              if (options.signal?.aborted) abort()
              else options.signal?.addEventListener("abort", abort, { once: true })
            })
          }
          return Response.json({ item: {
            status: { type: "idle" },
            messages: [{
              info: { role: "assistant", tokens: { input: 1, output: 1 } },
              parts: [{ type: "text", text: "Finished" }],
            }],
          } })
        }
        throw new Error(`Unexpected local request ${parsed.pathname}`)
      }

      denRequests.push(parsed.pathname)
      if (parsed.pathname === "/v1/automation-runner/work") {
        workRequests += 1
        return Response.json({ items: workRequests === 1 ? [{ runId: "run-1" }] : [] })
      }
      if (parsed.pathname.endsWith("/claim")) {
        if (deniedRoute === "claim") return Response.json({ message: "expired" }, { status })
        return Response.json({ assignment: testAssignment() })
      }
      if (parsed.pathname.endsWith("/events")) {
        if (deniedRoute === "events") return Response.json({ message: "expired" }, { status })
        return Response.json({ ok: true })
      }
      if (parsed.pathname.endsWith("/heartbeat")) {
        if (deniedRoute === "heartbeat") return Response.json({ message: "expired" }, { status })
        return Response.json({ leaseValid: true, cancelRequested: false })
      }
      if (parsed.pathname.endsWith("/complete")) {
        if (deniedRoute === "complete") return Response.json({ message: "expired" }, { status })
        return Response.json({ ok: true })
      }
      throw new Error(`Unexpected Den request ${parsed.pathname}`)
    },
    onCredentialRejected: resolveRejected,
    heartbeatIntervalMs: 1,
  })
  const configuration = {
    baseUrl: "https://den.example.com",
    token: runnerTokenFor("https://den.example.com"),
    runnerId: "runner-1",
  }
  runner.configure(configuration)
  if (deniedRoute === "heartbeat") await waitFor(() => snapshotStarted, "assignment did not start before heartbeat")
  await withTimeout(rejected, `${deniedRoute} credential rejection timed out`)
  await flushTasks()
  runner.configure(configuration)
  await flushTasks()
  runner.stop()
  return denRequests
}

function requestBudget(delays, windowMs) {
  let attempts = 0
  let nextAttemptAt = 0
  while (nextAttemptAt < windowMs) {
    nextAttemptAt += delays[Math.min(attempts, delays.length - 1)]
    attempts += 1
  }
  return attempts
}

test("model-not-found failures become a repairable Automation error", () => {
  assert.deepEqual(classifyAutomationExecutionError({
    name: "ProviderModelNotFoundError",
    message: "Model not found: opencode/big-pickle",
  }), {
    code: "model_access_lost",
    message: "The selected model opencode/big-pickle is no longer available. Choose a supported model to resume this Automation.",
  })
})

test("runner base URLs require a protected transport", () => {
  assert.equal(normalizeRunnerBaseUrl("https://den.example.com"), "https://den.example.com")
  assert.equal(normalizeRunnerBaseUrl("https://den.example.com/api/"), "https://den.example.com/api")
  assert.equal(normalizeRunnerBaseUrl("http://127.0.0.1:8788"), "http://127.0.0.1:8788")
  assert.equal(normalizeRunnerBaseUrl("http://localhost:8788"), "http://localhost:8788")
  assert.equal(normalizeRunnerBaseUrl("http://den.localhost:8788"), "http://den.localhost:8788")
  assert.equal(normalizeRunnerBaseUrl("http://attacker.example.com"), null)
  assert.equal(normalizeRunnerBaseUrl("ftp://den.example.com"), null)
  assert.equal(normalizeRunnerBaseUrl("https://user:pass@den.example.com"), null)
  assert.equal(normalizeRunnerBaseUrl("not a url"), null)
  assert.equal(normalizeRunnerBaseUrl(undefined), null)
})

test("runner credentials retain their signed Den audience", () => {
  assert.equal(runnerTokenAudience(runnerTokenFor("https://den.example.com/api/den")), "https://den.example.com/api/den")
  assert.equal(runnerTokenAudience("not-a-runner-token"), null)
  assert.equal(runnerTokenAudience(runnerTokenFor("http://attacker.example.com")), null)
})

test("a renderer-supplied non-https base URL never receives the runner token", async () => {
  const attempted = []
  const runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url) => {
      attempted.push(String(url))
      throw new Error("no network in test")
    },
  })
  runner.configure({
    baseUrl: "http://attacker.example.com",
    token: runnerTokenFor("http://attacker.example.com"),
    runnerId: "runner-1",
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  runner.stop()
  assert.deepEqual(attempted, [])
})

test("a renderer cannot redirect a Den runner credential to another HTTPS origin", async () => {
  const attempted = []
  const runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url) => {
      attempted.push(String(url))
      throw new Error("no network in test")
    },
  })
  runner.configure({
    baseUrl: "https://attacker.example.com",
    token: runnerTokenFor("https://den.example.com/api/den"),
    runnerId: "runner-1",
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  runner.stop()
  assert.deepEqual(attempted, [])
})

test("a v1 runner credential works only with a main-process trusted Den endpoint", async () => {
  const attempted = []
  const runner = createDesktopAutomationRunner({
    legacyBaseUrls: ["https://den.example.com/api/den"],
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url) => {
      attempted.push(String(url))
      throw new Error("no network in test")
    },
  })
  runner.configure({
    baseUrl: "https://den.example.com/api/den",
    token: legacyRunnerToken(),
    runnerId: "runner-1",
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  runner.stop()
  assert.ok(attempted.length > 0)
  assert.ok(attempted.every((url) => url.startsWith("https://den.example.com/api/den/")))
})

test("a v1 runner credential cannot use an untrusted HTTPS endpoint", async () => {
  const attempted = []
  const runner = createDesktopAutomationRunner({
    legacyBaseUrls: ["https://den.example.com/api/den"],
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url) => {
      attempted.push(String(url))
      throw new Error("no network in test")
    },
  })
  runner.configure({
    baseUrl: "https://attacker.example.com",
    token: legacyRunnerToken(),
    runnerId: "runner-1",
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  runner.stop()
  assert.deepEqual(attempted, [])
})

test("a runner credential bound elsewhere reports why this desktop stays disconnected", async () => {
  const logged = []
  const attempted = []
  const runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url) => {
      attempted.push(String(url))
      throw new Error("no network in test")
    },
    log: (state) => logged.push(state),
  })
  runner.configure({
    baseUrl: "https://den.example.com/api/den",
    token: runnerTokenFor("https://api.example.com"),
    runnerId: "runner-1",
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  runner.stop()
  assert.deepEqual(attempted, [])
  assert.deepEqual(logged, [
    "rejected runner credential for https://den.example.com/api/den"
      + ": token audience https://api.example.com",
  ])
})

test("repeated HTTP 502 responses retain exponential runner reconnect backoff", async () => {
  const { paths, delays } = await observeHttpFailureBackoff(502)
  assert.deepEqual(delays, EXPECTED_RECONNECT_DELAYS)
  assert.equal(paths.filter((path) => path === "/v1/automation-runner/work").length, 10)
  assert.equal(paths.filter((path) => path === "/v1/automation-runners/events").length, 0)
})

for (const status of [401, 403]) {
  test(`HTTP ${status} from work retires exactly that credential without reconnecting`, async () => {
    const { paths, delays, rejections } = await observeCredentialRejection(status, "/v1/automation-runner/work")
    assert.equal(paths.filter((path) => path === "/v1/automation-runner/work").length, 1)
    assert.equal(paths.filter((path) => path === "/v1/automation-runners/events").length, 0)
    assert.deepEqual(delays, [])
    assert.deepEqual(rejections, [status])
  })
}

test("HTTP 401 and 403 from every assignment route retire the credential", async () => {
  const routeSuffix = {
    claim: "/v1/automation-runs/run-1/claim",
    events: "/v1/automation-runs/run-1/events",
    heartbeat: "/v1/automation-runs/run-1/heartbeat",
    complete: "/v1/automation-runs/run-1/complete",
  }
  for (const status of [401, 403]) {
    for (const deniedRoute of Object.keys(routeSuffix)) {
      const requests = await observeAssignmentCredentialRejection(status, deniedRoute)
      assert.equal(requests.filter((path) => path === routeSuffix[deniedRoute]).length, 1)
      assert.equal(requests.filter((path) => path === "/v1/automation-runner/work").length, 1)
      assert.equal(requests.filter((path) => path === "/v1/automation-runners/events").length, 0)
    }
  }
})

test("a new credential reconciles immediately and a late rejection cannot retire it", async () => {
  const tokenA = runnerTokenFor("https://den.example.com")
  const tokenB = `${runnerTokenFor("https://den.example.com")}-fresh`
  const requests = []
  const delays = []
  const rejections = []
  let aWorkStarted = false
  let aWorkResponse = null
  const runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname
      const authorization = new Headers(options.headers).get("Authorization")
      requests.push({ path, authorization })
      if (authorization === `Bearer ${tokenA}`) {
        if (path === "/v1/automation-runner/work") {
          aWorkStarted = true
          while (aWorkResponse === null && !options.signal?.aborted) await new Promise((resolve) => setImmediate(resolve))
          if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted")
          return aWorkResponse
        }
      }
      if (path === "/v1/automation-runner/work") return Response.json({ items: [] })
      throw new Error(`Unexpected Den request ${path}`)
    },
    waitBeforeReconnect: async (ms, signal) => {
      delays.push(ms)
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    },
    onCredentialRejected: () => { rejections.push("rejected") },
  })

  runner.configure({ baseUrl: "https://den.example.com", token: tokenA, runnerId: "runner-1" })
  await waitFor(() => aWorkStarted, "token A request did not start")
  const bRequestStart = requests.length
  runner.configure({ baseUrl: "https://den.example.com", token: tokenB, runnerId: "runner-1" })
  await waitFor(
    () => requests.filter((request) => request.authorization === `Bearer ${tokenB}`).length === 1,
    "token B did not reconcile while token A was pending",
  )

  aWorkResponse = Response.json({ message: "expired" }, { status: 401 })
  await flushTasks()
  assert.deepEqual(rejections, [])
  assert.deepEqual(delays, [60_000])
  assert.equal(runner.configure({ baseUrl: "https://den.example.com", token: tokenB, runnerId: "runner-1" }).connected, true)

  assert.ok(requests.slice(bRequestStart).every((request) => request.authorization === `Bearer ${tokenB}`))
  runner.stop()
})

test("a late rejection retires a newer generation that reused the same credential", async () => {
  const tokenA = runnerTokenFor("https://den.example.com")
  const tokenB = `${tokenA}-fresh`
  const pendingA = []
  const requests = []
  const rejections = []
  const runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname
      const authorization = new Headers(options.headers).get("Authorization")
      requests.push({ path, authorization })
      const requestNumber = requests.filter((request) => request.path === path && request.authorization === authorization).length
      if (authorization === `Bearer ${tokenA}` && path === "/v1/automation-runner/work" && requestNumber === 1) {
        return new Promise((resolve) => { pendingA.push(() => resolve(Response.json({ message: "expired" }, { status: 401 }))) })
      }
      if (path === "/v1/automation-runner/work") return Response.json({ items: [] })
      throw new Error(`Unexpected Den request ${path}`)
    },
    onCredentialRejected: () => { rejections.push("rejected") },
  })
  const configurationA = { baseUrl: "https://den.example.com", token: tokenA, runnerId: "runner-1" }
  const configurationB = { baseUrl: "https://den.example.com", token: tokenB, runnerId: "runner-1" }

  runner.configure(configurationA)
  await waitFor(() => pendingA.length === 1, "first token A generation did not start")
  runner.configure(configurationB)
  await waitFor(
    () => requests.filter((request) => request.authorization === `Bearer ${tokenB}`).length === 1,
    "token B generation did not start",
  )
  runner.configure(configurationA)
  await waitFor(
    () => requests.filter((request) => request.authorization === `Bearer ${tokenA}`).length === 2,
    "second token A generation did not start",
  )
  for (const resolve of pendingA) resolve()
  await waitFor(() => rejections.length === 1, "reused token A was not retired")
  assert.equal(runner.configure(configurationA).connected, false)
  await flushTasks()
  assert.equal(requests.filter((request) => request.authorization === `Bearer ${tokenA}`).length, 2)
  runner.stop()
})

test("routine credential rotation waits for the active assignment to complete", async () => {
  const tokenA = runnerTokenFor("https://den.example.com")
  const tokenB = `${tokenA}-fresh`
  const requests = []
  let offeredAssignment = false
  let snapshotStarted = false
  let finishSnapshot = false
  let localAborts = 0
  const runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url)
      if (parsed.origin === "http://127.0.0.1:3000") {
        if (parsed.pathname === "/workspaces") return Response.json({ items: [{ id: "workspace-1" }], activeId: "workspace-1" })
        if (parsed.pathname === "/workspace/workspace-1/sessions") return Response.json({ item: { id: "session-1" } })
        if (parsed.pathname.endsWith("/abort")) { localAborts += 1; return Response.json({ ok: true }) }
        if (parsed.pathname.endsWith("/snapshot")) {
          snapshotStarted = true
          while (!finishSnapshot) await new Promise((resolve) => setImmediate(resolve))
          return Response.json({ item: {
            status: { type: "idle" },
            messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Finished" }] }],
          } })
        }
      }
      const path = parsed.pathname
      const authorization = new Headers(options.headers).get("Authorization")
      requests.push({ path, authorization })
      if (path === "/v1/automation-runner/work") {
        if (!offeredAssignment && authorization === `Bearer ${tokenA}`) {
          offeredAssignment = true
          return Response.json({ items: [{ runId: "run-1" }] })
        }
        return Response.json({ items: [] })
      }
      if (path.endsWith("/claim")) return Response.json({ assignment: testAssignment() })
      return Response.json({ ok: true })
    },
  })
  const configurationA = { baseUrl: "https://den.example.com", token: tokenA, runnerId: "runner-1" }
  const configurationB = { baseUrl: "https://den.example.com", token: tokenB, runnerId: "runner-1" }
  runner.configure(configurationA)
  await waitFor(() => snapshotStarted, "assignment did not start")
  assert.equal(runner.configure(configurationB).connected, true)
  await flushTasks()
  assert.equal(requests.filter((request) => request.authorization === `Bearer ${tokenB}`).length, 0)
  assert.equal(localAborts, 0)

  finishSnapshot = true
  await waitFor(
    () => requests.filter((request) => request.authorization === `Bearer ${tokenB}`).length === 1,
    "fresh credential did not connect after assignment completion",
  )
  assert.equal(localAborts, 0)
  assert.ok(requests.some((request) => request.path.endsWith("/complete") && request.authorization === `Bearer ${tokenA}`))
  runner.stop()
})

test("routine credential rotation waits for an in-flight claim", async () => {
  const tokenA = runnerTokenFor("https://den.example.com")
  const tokenB = `${tokenA}-fresh`
  const requests = []
  /** @type {(response: Response) => void} */
  let resolveClaim = () => {}
  const claimResponse = new Promise((resolve) => { resolveClaim = resolve })
  const runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url)
      if (parsed.origin === "http://127.0.0.1:3000") {
        if (parsed.pathname === "/workspaces") return Response.json({ items: [{ id: "workspace-1" }], activeId: "workspace-1" })
        if (parsed.pathname === "/workspace/workspace-1/sessions") return Response.json({ item: { id: "session-1" } })
        if (parsed.pathname.endsWith("/snapshot")) {
          return Response.json({ item: {
            status: { type: "idle" },
            messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Finished" }] }],
          } })
        }
      }
      const path = parsed.pathname
      const authorization = new Headers(options.headers).get("Authorization")
      requests.push({ path, authorization })
      if (path === "/v1/automation-runner/work") {
        const offered = requests.some((request) => request.path.endsWith("/claim"))
        return Response.json({ items: offered ? [] : [{ runId: "run-1" }] })
      }
      if (path.endsWith("/claim")) return claimResponse
      return Response.json({ ok: true })
    },
  })
  const configurationA = { baseUrl: "https://den.example.com", token: tokenA, runnerId: "runner-1" }
  const configurationB = { baseUrl: "https://den.example.com", token: tokenB, runnerId: "runner-1" }
  runner.configure(configurationA)
  await waitFor(() => requests.some((request) => request.path.endsWith("/claim")), "claim did not start")
  assert.equal(runner.configure(configurationB).connected, true)
  await flushTasks()
  assert.equal(requests.filter((request) => request.authorization === `Bearer ${tokenB}`).length, 0)

  resolveClaim(Response.json({ assignment: testAssignment() }))
  await waitFor(
    () => requests.filter((request) => request.authorization === `Bearer ${tokenB}`).length === 1,
    "fresh credential did not connect after the claimed assignment completed",
  )
  assert.ok(requests.some((request) => request.path.endsWith("/complete") && request.authorization === `Bearer ${tokenA}`))
  runner.stop()
})

test("retiring a generation cancels its reconnect wait", async () => {
  const tokenA = runnerTokenFor("https://den.example.com")
  const tokenB = `${tokenA}-fresh`
  /** @type {AbortSignal | null} */
  let waitSignal = null
  const reconnectWaitAborted = () => waitSignal?.aborted === true
  const runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url) => {
      const path = new URL(url).pathname
      if (path === "/v1/automation-runner/work") return new Response(null, { status: 502 })
      throw new Error(`Unexpected request ${path}`)
    },
    waitBeforeReconnect: async (_ms, signal) => {
      waitSignal = signal
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    },
  })
  runner.configure({ baseUrl: "https://den.example.com", token: tokenA, runnerId: "runner-1" })
  await waitFor(() => waitSignal !== null, "reconnect wait did not start")
  runner.configure({ baseUrl: "https://den.example.com", token: tokenB, runnerId: "runner-1" })
  assert.equal(reconnectWaitAborted(), true)
  runner.stop()
})

test("runner HTTP failure request budget drops from the reset-on-response baseline", () => {
  const previousResetOnResponseDelays = Array(10).fill(500)
  assert.equal(requestBudget(previousResetOnResponseDelays, 60_000), 120)
  assert.equal(requestBudget(EXPECTED_RECONNECT_DELAYS, 60_000), 7)
  assert.equal(previousResetOnResponseDelays.reduce((total, delay) => total + delay, 0), 5_000)
  assert.equal(EXPECTED_RECONNECT_DELAYS.reduce((total, delay) => total + delay, 0), 151_500)
})

test("a healthy work poll resets runner reconnect backoff", async () => {
  const delays = []
  let workRequests = 0
  const done = new AbortController()
  let runner = null
  runner = createDesktopAutomationRunner({
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local" }),
    fetchImpl: async (url) => {
      const path = new URL(url).pathname
      assert.equal(path, "/v1/automation-runner/work")
      workRequests += 1
      if (workRequests <= 3) return new Response(null, { status: 502 })
      return Response.json({ items: [] })
    },
    random: () => 0.5,
    waitBeforeReconnect: async (ms) => {
      delays.push(ms)
      await new Promise((resolve) => setImmediate(resolve))
      if (delays.length === 4) {
        runner.stop()
        done.abort()
      }
    },
  })
  runner.configure({
    baseUrl: "https://den.example.com",
    token: runnerTokenFor("https://den.example.com"),
    runnerId: "runner-1",
  })
  if (!done.signal.aborted) {
    await new Promise((resolve) => done.signal.addEventListener("abort", resolve, { once: true }))
  }
  assert.deepEqual(delays, [500, 1_000, 2_000, 60_000])
})

test("desktop Automation execution creates a normal visible local OpenWork thread", async () => {
  const requests = []
  let snapshots = 0
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    const body = options.body ? JSON.parse(options.body) : null
    requests.push({ path: parsed.pathname, method: options.method ?? "GET", body })
    if (parsed.pathname === "/workspaces") {
      return Response.json({ items: [{ id: "workspace-1" }], activeId: "workspace-1" })
    }
    if (parsed.pathname === "/workspace/workspace-1/sessions" && options.method === "POST") {
      return Response.json({ item: { id: "session-1" }, started: true }, { status: 201 })
    }
    if (parsed.pathname === "/workspace/workspace-1/sessions/session-1/snapshot") {
      snapshots += 1
      return Response.json({ item: {
        status: { type: snapshots === 1 ? "busy" : "idle" },
        messages: snapshots === 1 ? [] : [{
          info: { role: "assistant", tokens: { input: 12, output: 7 } },
          parts: [{ type: "text", text: "Desktop runner result" }],
        }],
      } })
    }
    throw new Error(`Unexpected request ${parsed.pathname}`)
  }

  const result = await executeDesktopAutomation({
    executionTarget: "desktop",
    runId: "run-1",
    automationId: "automation-1",
    automationName: "Daily brief",
    instructions: "Prepare the brief",
    model: { providerId: "opencode", modelId: "big-pickle" },
    timeoutMs: 30_000,
    leaseExpiresAt: Date.now() + 60_000,
    attempt: 1,
  }, {
    getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local-client-token" }),
    fetchImpl,
    signal: new AbortController().signal,
  })

  assert.equal(result.sessionId, "session-1")
  assert.equal(result.workspaceId, "workspace-1")
  assert.equal(result.resultSummary, "Desktop runner result")
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7, costMicros: null })
  const create = requests.find((request) => request.path === "/workspace/workspace-1/sessions")
  assert.deepEqual(create?.body, {
    title: "Automation: Daily brief",
    prompt: "Prepare the brief",
    providerId: "opencode",
    modelId: "big-pickle",
  })
})

test("desktop Automation execution surfaces a missing pinned model", async () => {
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    if (parsed.pathname === "/workspaces") {
      return Response.json({ items: [{ id: "workspace-1" }], activeId: "workspace-1" })
    }
    if (parsed.pathname === "/workspace/workspace-1/sessions" && options.method === "POST") {
      return Response.json({ item: { id: "session-1" }, started: true }, { status: 201 })
    }
    if (parsed.pathname === "/workspace/workspace-1/sessions/session-1/snapshot") {
      return Response.json({ item: {
        status: { type: "idle" },
        messages: [{
          info: {
            role: "assistant",
            error: {
              name: "ProviderModelNotFoundError",
              message: "Model not found: opencode/big-pickle",
            },
          },
          parts: [],
        }],
      } })
    }
    throw new Error(`Unexpected request ${parsed.pathname}`)
  }

  await assert.rejects(
    executeDesktopAutomation({
      executionTarget: "desktop",
      runId: "run-1",
      automationId: "automation-1",
      automationName: "Daily brief",
      instructions: "Prepare the brief",
      model: { providerId: "opencode", modelId: "big-pickle" },
      timeoutMs: 30_000,
      leaseExpiresAt: Date.now() + 60_000,
      attempt: 1,
    }, {
      getLocalRuntime: async () => ({ baseUrl: "http://127.0.0.1:3000", token: "local-client-token" }),
      fetchImpl,
      signal: new AbortController().signal,
    }),
    (error) => error instanceof Error
      && Reflect.get(error, "code") === "model_access_lost"
      && /Choose a supported model/.test(error.message),
  )
})
