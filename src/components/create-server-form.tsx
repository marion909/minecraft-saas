"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  checkAddressAvailable,
  checkNameAvailable,
  createServer,
  type ServerFormState,
} from "@/app/(app)/servers/actions";

import {
  blocks,
  useAvailability,
  type AvailabilityState,
} from "./use-availability";

/**
 * Der Platz unter dem Feld zeigt genau eine Sache: erst den Hinweis, beim
 * Tippen den Stand der Prüfung, nach einem abgelehnten Abschicken die
 * Meldung vom Server. Nichts davon springt übereinander.
 */
function FieldStatus({
  state,
  serverError,
  hint,
}: {
  state: AvailabilityState;
  serverError?: string;
  hint: string;
}) {
  if (state.status === "prüft") {
    return <span className="hint">wird geprüft …</span>;
  }

  if (state.status === "fertig") {
    return state.result.state === "frei" ? (
      <span className="field-ok">frei</span>
    ) : (
      <span className="field-error">{state.result.reason}</span>
    );
  }

  if (serverError) {
    return <span className="field-error">{serverError}</span>;
  }

  return <span className="hint">{hint}</span>;
}

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
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [planId, setPlanId] = useState(plans.find((p) => p.slots > 0)?.id ?? "");

  const nameState = useAvailability(name, checkNameAvailable);
  const addressState = useAvailability(subdomain, checkAddressAvailable);

  return (
    <form className="stack" action={formAction}>
      {state.error ? <p className="notice notice-error">{state.error}</p> : null}

      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          required
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={blocks(nameState) ? true : undefined}
        />
        <FieldStatus
          state={nameState}
          serverError={state.fields?.name}
          hint="Nur für dich, im Panel."
        />
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
            aria-invalid={blocks(addressState) ? true : undefined}
          />
          <span className="addr-suffix">.{publicHost}</span>
        </div>
        <FieldStatus
          state={addressState}
          serverError={state.fields?.subdomain}
          hint="Unter dieser Adresse verbinden sich Spieler. Später nicht mehr änderbar."
        />
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
          disabled={
            pending ||
            plans.every((plan) => plan.slots <= 0) ||
            blocks(nameState) ||
            blocks(addressState)
          }
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
