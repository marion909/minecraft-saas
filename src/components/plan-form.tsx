"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { PlanFormState } from "@/app/(app)/admin/plans/actions";

export type PlanDefaults = {
  name: string;
  slug: string;
  memoryMb: number | "";
  cpuCores: number | "";
  diskMb: number | "";
  maxPlayers: number | "";
  maxBackups: number | "";
  maxServers: number | "";
  priceCents: number | "";
  isPublic: boolean;
};

export const EMPTY_PLAN: PlanDefaults = {
  name: "",
  slug: "",
  memoryMb: 4096,
  cpuCores: 2,
  diskMb: 25000,
  maxPlayers: 20,
  maxBackups: 7,
  maxServers: 1,
  priceCents: 0,
  isPublic: false,
};

type Field = {
  name: keyof PlanDefaults;
  label: string;
  hint?: string;
  type?: "text" | "number";
  step?: string;
};

const FIELDS: Field[] = [
  { name: "name", label: "Name", hint: "Was der Nutzer sieht, z. B. „Basic“." },
  {
    name: "slug",
    label: "Kennung",
    hint: "Kleinbuchstaben, Ziffern, Bindestriche. Wird nicht mehr geändert, sobald Server darauf laufen.",
  },
  {
    name: "memoryMb",
    label: "Arbeitsspeicher (MB)",
    type: "number",
    hint: "Das Container-Limit. Der JVM-Heap wird daraus abgeleitet und liegt bewusst darunter.",
  },
  {
    name: "cpuCores",
    label: "CPU-Kerne",
    type: "number",
    step: "0.5",
    hint: "Obergrenze für Lastspitzen, keine feste Zuteilung.",
  },
  { name: "diskMb", label: "Speicherplatz (MB)", type: "number", hint: "Harte ZFS-Quota." },
  { name: "maxPlayers", label: "Spieler", type: "number" },
  { name: "maxBackups", label: "Backups", type: "number", hint: "Ältester Snapshot rotiert heraus." },
  { name: "maxServers", label: "Server pro Nutzer", type: "number" },
  {
    name: "priceCents",
    label: "Preis (Cent)",
    type: "number",
    hint: "Wird erst ab P8 abgerechnet, gehört aber schon jetzt ins Modell.",
  },
];

export function PlanForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (state: PlanFormState, formData: FormData) => Promise<PlanFormState>;
  defaults: PlanDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form className="stack" action={formAction}>
      {state.error ? <p className="notice notice-error">{state.error}</p> : null}

      <div className="field-grid">
        {FIELDS.map((field) => {
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
                aria-describedby={error ? `${field.name}-error` : undefined}
                required
              />
              {error ? (
                <span className="field-error" id={`${field.name}-error`}>
                  {error}
                </span>
              ) : field.hint ? (
                <span className="hint">{field.hint}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          name="isPublic"
          defaultChecked={defaults.isPublic}
        />
        <span>
          Öffentlich buchbar
          <span className="hint">
            Nicht öffentliche Tarife bleiben bestehen, tauchen aber bei der
            Server-Bestellung nicht auf.
          </span>
        </span>
      </label>

      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Wird gespeichert …" : submitLabel}
        </button>
        <Link className="btn btn-quiet" href="/admin/plans">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
