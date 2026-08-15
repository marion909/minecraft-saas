"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { createServer, type ServerFormState } from "@/app/(app)/servers/actions";

export type PlanChoice = {
  id: string;
  name: string;
  memoryMb: number;
  cpuCores: number;
  diskMb: number;
  maxPlayers: number;
  priceCents: number;
  /** Wie oft der Tarif noch auf den Node passt; 0 heißt belegt. */
  slots: number;
};

const SOFTWARE = [
  { value: "PAPER", label: "Paper", hint: "Empfohlen. Schnell, Plugin-fähig." },
  { value: "VANILLA", label: "Vanilla", hint: "Original ohne Erweiterungen." },
  { value: "PURPUR", label: "Purpur", hint: "Paper mit mehr Stellschrauben." },
  { value: "FABRIC", label: "Fabric", hint: "Für Fabric-Mods." },
  { value: "FORGE", label: "Forge", hint: "Für Forge-Modpacks." },
];

export function CreateServerForm({
  plans,
  publicHost,
}: {
  plans: PlanChoice[];
  publicHost: string;
}) {
  const [state, formAction, pending] = useActionState<ServerFormState, FormData>(
    createServer,
    {},
  );
  const [subdomain, setSubdomain] = useState("");
  const [planId, setPlanId] = useState(plans.find((p) => p.slots > 0)?.id ?? "");

  return (
    <form className="stack" action={formAction}>
      {state.error ? <p className="notice notice-error">{state.error}</p> : null}

      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" required maxLength={40} defaultValue="" />
        {state.fields?.name ? (
          <span className="field-error">{state.fields.name}</span>
        ) : (
          <span className="hint">Nur für dich, im Panel.</span>
        )}
      </div>

      <div className="field">
        <label htmlFor="subdomain">Adresse</label>
        <div className="addr">
          <input
            id="subdomain"
            name="subdomain"
            required
            value={subdomain}
            onChange={(event) =>
              setSubdomain(event.target.value.toLowerCase().replace(/\s/g, ""))
            }
            placeholder="meinserver"
          />
          <span className="addr-suffix">.{publicHost}</span>
        </div>
        {state.fields?.subdomain ? (
          <span className="field-error">{state.fields.subdomain}</span>
        ) : (
          <span className="hint">
            Unter dieser Adresse verbinden sich Spieler. Später nicht mehr
            änderbar.
          </span>
        )}
      </div>

      <fieldset className="fieldset">
        <legend>Tarif</legend>
        {state.fields?.planId ? (
          <span className="field-error">{state.fields.planId}</span>
        ) : null}

        <div className="choices">
          {plans.map((plan) => {
            const full = plan.slots <= 0;

            return (
              <label
                className={`choice${full ? " choice-disabled" : ""}`}
                key={plan.id}
              >
                <input
                  type="radio"
                  name="planId"
                  value={plan.id}
                  checked={planId === plan.id}
                  disabled={full}
                  onChange={() => setPlanId(plan.id)}
                  required
                />
                <span className="choice-body">
                  <span className="choice-head">
                    <strong>{plan.name}</strong>
                    {full ? (
                      <span className="chip chip-warn">belegt</span>
                    ) : (
                      <span className="chip">
                        {plan.priceCents === 0
                          ? "kostenlos"
                          : `${(plan.priceCents / 100).toFixed(2)} €`}
                      </span>
                    )}
                  </span>
                  <span className="hint">
                    {(plan.memoryMb / 1024).toFixed(0)} GB RAM ·{" "}
                    {plan.cpuCores} Kerne · {(plan.diskMb / 1024).toFixed(0)} GB
                    Speicher · {plan.maxPlayers} Spieler
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="field-grid">
        <div className="field">
          <label htmlFor="serverType">Server-Software</label>
          <select id="serverType" name="serverType" defaultValue="PAPER">
            {SOFTWARE.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label} — {item.hint}
              </option>
            ))}
          </select>
          {state.fields?.serverType ? (
            <span className="field-error">{state.fields.serverType}</span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="mcVersion">Version</label>
          <input id="mcVersion" name="mcVersion" defaultValue="LATEST" />
          <span className="hint">
            <code>LATEST</code> oder eine feste Version wie <code>1.21.8</code>.
            Die passende Java-Fassung wird daraus abgeleitet.
          </span>
        </div>
      </div>

      <div className="actions">
        <button
          className="btn btn-primary"
          type="submit"
          disabled={pending || plans.every((plan) => plan.slots <= 0)}
        >
          {pending ? "Wird angelegt …" : "Server anlegen"}
        </button>
        <Link className="btn btn-quiet" href="/dashboard">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
