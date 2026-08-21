import { useState } from "react"
import { createRoot } from "react-dom/client"
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react"
import {
  skillCreatedPayloadSchema,
  type SkillCreatedPayload,
} from "@openwork/types/skill-created-app"
import "./skill-created.css"

function SkillCreated() {
  const [payload, setPayload] = useState<SkillCreatedPayload | null>(null)
  const [resultError, setResultError] = useState<string | null>(null)
  const { app, error } = useApp({
    appInfo: { name: "OpenWork Skill Created", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (createdApp) => {
      createdApp.ontoolresult = (result) => {
        const parsed = skillCreatedPayloadSchema.safeParse(result.structuredContent)
        if (!parsed.success) {
          setResultError("The skill result did not match the expected data contract.")
          return
        }
        setPayload(parsed.data)
      }
      createdApp.ontoolcancelled = ({ reason }) => {
        setResultError(reason ?? "Skill creation was cancelled.")
      }
    },
  })
  useHostStyles(app, app?.getHostContext())

  if (error || resultError) {
    return <main className="card card-status">{error?.message ?? resultError}</main>
  }
  if (!payload) {
    return <main className="card card-status">Finishing your skill...</main>
  }

  const openLibrary = () => {
    if (payload.libraryUrl) void app?.openLink({ url: payload.libraryUrl })
  }

  return (
    <main className="card">
      <header className="header">
        <span className="mark" aria-hidden="true">S</span>
        <div>
          <p className="eyebrow">Skill created</p>
          <h1>{payload.name}</h1>
        </div>
        <span className="ready">Ready</span>
      </header>
      <p className="description">{payload.description}</p>
      <dl className="identifiers">
        <div>
          <dt>Plugin</dt>
          <dd>{payload.pluginId}</dd>
        </div>
        <div>
          <dt>Skill</dt>
          <dd>{payload.skillId}</dd>
        </div>
      </dl>
      {payload.libraryUrl ? (
        <button className="library-link" type="button" onClick={openLibrary}>
          Open in Library <span aria-hidden="true">-&gt;</span>
        </button>
      ) : null}
    </main>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Skill Created App root is missing.")
createRoot(root).render(<SkillCreated />)
