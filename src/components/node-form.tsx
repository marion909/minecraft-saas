"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useActionState } from "react";

import {
  probeAgent,
  type NodeFormState,
  type NodeProbe,
} from "@/app/(app)/admin/nodes/actions";

export type NodeDefaults = {
  name: string;
  agentUrl: string;
  publicHost: string;
  totalMemoryMb: number | "";
  totalCpuCores: number | "";
  totalDiskMb: number | "";
  reservedMemoryMb: number | "";
  reservedDiskMb: number | "";
  cpuOvercommit: number | "";
  status: string;
};

/**
 * Vorbelegung für einen neuen Node. Bewusst die Werte des ersten Hosts
 * und nicht Nullen: Wer hier landet, hat meistens genau so eine Kiste
 * vor sich und korrigiert schneller, als er ausfüllt.
 */
export const EMPTY_NODE: NodeDefaults = {
  name: "",
  agentUrl: "http://127.0.0.1:8787",
  publicHost: "",
  totalMemoryMb: 32768,
  totalCpuCores: 8,
  totalDiskMb: 900000,
  reservedMemoryMb: 4096,
  reservedDiskMb: 51200,
  cpuOvercommit: 2,
  status: "ONLINE",
};

type Field = {
  name: keyof NodeDefaults;
  label: string;
  hint?: string;
  type?: "text" | "number";
  step?: string;
};

const NUMBERS: Field[] = [
  {
    name: "totalMemoryMb",
    label: "Arbeitsspeicher gesamt (MB)",
    type: "number",
    hint: "Was im Host steckt. 32 GB sind 32768.",
  },
  {
    name: "reservedMemoryMb",
    label: "davon reserviert (MB)",
    type: "number",
    hint: "Für System, ZFS-ARC, Datenbank, Panel und Agent. Unter 4096 wird es eng.",
  },
  {
    name: "totalCpuCores",
    label: "CPU-Kerne",
    type: "number",
    step: "0.5",
    hint: "Physische bzw. logische Kerne des Hosts.",
  },
  {
    name: "cpuOvercommit",
    label: "CPU-Überbuchung",
    type: "number",
    step: "0.5",
    hint: "2 heißt: doppelt so viele Kerne vergeben wie vorhanden. Server sind meist im Leerlauf.",
  },
  {
    name: "totalDiskMb",
    label: "Speicherplatz gesamt (MB)",
    type: "number",
    hint: "Was der Pool für Weltdaten hergibt.",
  },
  {
    name: "reservedDiskMb",
    label: "davon reserviert (MB)",
    type: "number",
    hint: "Puffer für Snapshots und Images. ZFS mag keine volle Platte.",
  },
];

function ProbeResult({ probe }: { probe: NodeProbe }) {
  if (probe.state === "fehler") {
    return <p className="notice notice-error">Keine Verbindung: {probe.reason}</p>;
  }

  return (
    <div className="notice">
      <strong>Agent antwortet.</strong> Speicher: {probe.storage}
      {probe.hardQuota ? " (harte Quota)" : " (ohne harte Quota)"} · Netz:{" "}
      <code>{probe.network}</code>
      {!probe.dockerOk ? (
        <>
          <br />
          Docker meldet ein Problem: {probe.dockerError ?? "unbekannt"}
        </>
      ) : null}
      {!probe.hardQuota ? (
        <>
          <br />
          Ohne ZFS greift die Speichergrenze nicht — Server können den Node
          volllaufen lassen. Für Produktion nicht geeignet.
        </>
      ) : null}
    </div>
  );
}

export function NodeForm({
  action,
  defaults,
  submitLabel,
  nodeId,
}: {
  action: (state: NodeFormState, formData: FormData) => Promise<NodeFormState>;
  defaults: NodeDefaults;
  submitLabel: string;
  /** Gesetzt beim Bearbeiten — dann darf das Tokenfeld leer bleiben. */
  nodeId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [probe, setProbe] = useState<NodeProbe | null>(null);
  const [testing, startTest] = useTransition();

  // Kontrolliert, damit der Verbindungstest die aktuellen Eingaben sieht,
  // ohne dass das Formular abgeschickt werden muss.
  const [agentUrl, setAgentUrl] = useState(defaults.agentUrl);
  const [agentToken, setAgentToken] = useState("");

  return (
    <form className="stack" action={formAction}>
      {state.error ? <p className="notice notice-error">{state.error}</p> : null}

      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          defaultValue={defaults.name}
          autoComplete="off"
          required
          aria-invalid={state.fields?.name ? true : undefined}
        />
        {state.fields?.name ? (
          <span className="field-error">{state.fields.name}</span>
        ) : (
          <span className="hint">
            Nur intern sichtbar, z. B. „daheim“ oder „hetzner-1“.
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="publicHost">Öffentlicher Hostname</label>
        <input
          id="publicHost"
          name="publicHost"
          defaultValue={defaults.publicHost}
          placeholder="mc.example.com"
          autoComplete="off"
          required
          aria-invalid={state.fields?.publicHost ? true : undefined}
        />
        {state.fields?.publicHost ? (
          <span className="field-error">{state.fields.publicHost}</span>
        ) : (
          <span className="hint">
            Serveradressen entstehen daraus als{" "}
            <code>name.{defaults.publicHost || "mc.example.com"}</code>. Dafür
            muss <code>*.{defaults.publicHost || "mc.example.com"}</code> per DNS
            auf diesen Host zeigen — ohne Cloudflare-Proxy, Minecraft ist kein
            HTTP.
          </span>
        )}
      </div>

      <fieldset className="fieldset">
        <legend>Agent</legend>

        <div className="field">
          <label htmlFor="agentUrl">Adresse</label>
          <input
            id="agentUrl"
            name="agentUrl"
            value={agentUrl}
            onChange={(event) => setAgentUrl(event.target.value)}
            autoComplete="off"
            required
            aria-invalid={state.fields?.agentUrl ? true : undefined}
          />
          {state.fields?.agentUrl ? (
            <span className="field-error">{state.fields.agentUrl}</span>
          ) : (
            <span className="hint">
              Läuft der Agent auf demselben Rechner wie das Panel, ist das{" "}
              <code>http://127.0.0.1:8787</code>. Der Agent gehört nie ans
              offene Netz.
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="agentToken">Token</label>
          <input
            id="agentToken"
            name="agentToken"
            type="password"
            value={agentToken}
            onChange={(event) => setAgentToken(event.target.value)}
            autoComplete="off"
            placeholder={nodeId ? "unverändert lassen" : ""}
            required={!nodeId}
            aria-invalid={state.fields?.agentToken ? true : undefined}
          />
          {state.fields?.agentToken ? (
            <span className="field-error">{state.fields.agentToken}</span>
          ) : (
            <span className="hint">
              Steht als <code>AGENT_TOKEN</code> in der <code>.env</code> des
              Hosts. Wer es hat, hat root auf diesem Host.
              {nodeId ? " Leer lassen heißt: unverändert." : ""}
            </span>
          )}
        </div>

        <div className="actions">
          <button
            className="btn btn-quiet"
            type="button"
            disabled={testing}
            onClick={() =>
              startTest(async () => {
                setProbe(await probeAgent(agentUrl, agentToken, nodeId ?? null));
              })
            }
          >
            {testing ? "Prüfe …" : "Verbindung prüfen"}
          </button>
        </div>

        {probe ? <ProbeResult probe={probe} /> : null}
      </fieldset>

      <fieldset className="fieldset">
        <legend>Kapazität</legend>
        <p className="hint" style={{ maxWidth: "60ch" }}>
          Diese Zahlen sind Buchhaltung, keine Messung. Das Panel vergibt
          höchstens so viel, wie hier steht — trägt jemand mehr ein, als der
          Host hat, merkt das niemand, bis der erste Server mitten im Spiel
          abgeräumt wird.
        </p>

        <div className="field-grid">
          {NUMBERS.map((field) => {
            const error = state.fields?.[field.name];

            return (
              <div className="field" key={field.name}>
                <label htmlFor={field.name}>{field.label}</label>
                <input
                  id={field.name}
                  name={field.name}
                  type={field.type ?? "text"}
                  step={field.step}
                  defaultValue={String(defaults[field.name])}
                  aria-invalid={error ? true : undefined}
                  required
                />
                {error ? (
                  <span className="field-error">{error}</span>
                ) : field.hint ? (
                  <span className="hint">{field.hint}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="status">Zustand</label>
        <select id="status" name="status" defaultValue={defaults.status}>
          <option value="ONLINE">ONLINE — nimmt neue Server an</option>
          <option value="DRAINING">
            DRAINING — keine neuen, vorhandene laufen weiter
          </option>
          <option value="OFFLINE">OFFLINE — außer Betrieb</option>
        </select>
        {state.fields?.status ? (
          <span className="field-error">{state.fields.status}</span>
        ) : (
          <span className="hint">
            Vor einem Neustart oder Umzug auf DRAINING setzen: Dann läuft
            niemandem mitten in der Wartung ein neuer Server auf.
          </span>
        )}
      </div>

      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Wird gespeichert …" : submitLabel}
        </button>
        <Link className="btn btn-quiet" href="/admin/nodes">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
