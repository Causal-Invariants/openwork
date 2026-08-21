"use client"

import * as React from "react"
import { Check, Copy, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { AuthorityRefusal } from "@/components/tools/error-attribution"

/**
 * The host half of Agent-FDE's legible-refusal contract.
 *
 * A refusal for want of execution authority arrives as structured fields
 * rather than a sentence, so that this panel can state what was asked, what
 * was held, and -- where a grant is in fact the remedy -- the exact command
 * that would supply it.
 *
 * Two things it deliberately does not do.
 *
 * It never names who could grant the authority. The refusal does not carry
 * that, on purpose: naming a third party who *could* grant leaks
 * organisational structure to a caller who has just been told it holds none.
 * `--grantor` and `--grantee` are therefore rendered as placeholders for the
 * operator to fill from what they already know, not as values read out of a
 * payload that does not contain them.
 *
 * It never renders copy that came from the tool. Tool output is untrusted;
 * every string a reader sees here is fixed in this file, and the payload's
 * fields appear only as escaped data in value positions.
 */

const CEILING_EXPLANATION
  = "A policy ceiling caps what this actor kind may do, so this refusal is not "
    + "for want of a grant and issuing one will not lift it. The act has to be "
    + "performed by a principal the ceiling does not cap, or proposed for a "
    + "human to approve."

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 truncate font-mono">{value}</dd>
    </div>
  )
}

/**
 * The command that would supply the missing grant, or `null` when this
 * refusal cannot be expressed as one.
 *
 * `agent-fde stakeholder grant` scopes a grant to an engagement and takes no
 * other scope kind. A refusal at a global or principal scope is a real
 * refusal, but this command is not its remedy, and printing it with the
 * engagement flag holding something that is not an engagement id would be
 * worse than printing nothing.
 */
export function grantCommandFor(refusal: AuthorityRefusal): string | null {
  if (refusal.ceilingApplied) return null
  if (refusal.scopeKind !== "engagement" || !refusal.scopeRef) return null
  return [
    "agent-fde stakeholder grant",
    `--engagement ${refusal.scopeRef}`,
    "--grantor <GRANTOR>",
    "--grantee <GRANTEE>",
    `--action-class ${refusal.actionClass}`,
  ].join(" ")
}

export function AuthorityRefusalNotice({ refusal }: { refusal: AuthorityRefusal }) {
  const [copied, setCopied] = React.useState(false)
  const command = grantCommandFor(refusal)

  const copy = React.useCallback(async () => {
    if (command === null) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be unavailable outside a secure browser context.
    }
  }, [command])

  return (
    <section
      className="border-border/70 bg-background/50 mt-2 rounded-lg border p-2 text-xs"
      aria-label="Authority refusal"
      data-testid="authority-refusal-notice"
    >
      <h3 className="mb-1.5 flex items-center gap-1.5 font-medium">
        <ShieldAlert className="text-destructive size-3.5" aria-hidden="true" />
        {refusal.ceilingApplied ? "Capped by a policy ceiling" : "Request this grant"}
      </h3>

      <dl className="grid gap-0.5">
        <Field label="Action" value={refusal.actionClass} />
        <Field
          label="Scope"
          value={refusal.scopeRef ? `${refusal.scopeKind} ${refusal.scopeRef}` : refusal.scopeKind}
        />
        <Field label="Needs" value={refusal.required} />
        <Field label="Holds" value={refusal.resolved} />
        {refusal.actorKind ? <Field label="As" value={refusal.actorKind} /> : null}
        {refusal.basis ? <Field label="Basis" value={refusal.basis} /> : null}
      </dl>

      {refusal.ceilingApplied ? (
        <p className="text-muted-foreground mt-1.5">{CEILING_EXPLANATION}</p>
      ) : command === null ? (
        <p className="text-muted-foreground mt-1.5">
          A grant covering this action at this scope would lift the refusal. This scope
          is not an engagement, so it cannot be requested with the engagement-scoped
          grant command.
        </p>
      ) : (
        <div className="mt-1.5">
          <p className="text-muted-foreground mb-1">
            Fill in the grantor and grantee, then run this in the workspace:
          </p>
          <div className="flex items-start gap-1">
            <pre className="bg-muted min-w-0 flex-1 overflow-x-auto rounded p-1.5 font-mono">
              {command}
            </pre>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-testid="authority-refusal-copy-action"
              title={copied ? "Copied" : "Copy grant command"}
              aria-label={copied ? "Grant command copied" : "Copy grant command"}
              onClick={() => void copy()}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
