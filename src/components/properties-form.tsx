"use client";

import { useActionState } from "react";

import {
  saveProperties,
  type FileFormState,
} from "@/app/(app)/servers/[id]/files/actions";

export type GuidedProperty = {
  key: string;
  label: string;
  type: "text" | "boolean" | "number" | "select";
  options?: string[];
  hint?: string;
};

export function PropertiesForm({
  serverId,
  guided,
  values,
}: {
  serverId: string;
  guided: GuidedProperty[];
  values: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<FileFormState, FormData>(
    saveProperties,
    {},
  );

  const booleanKeys = guided
    .filter((property) => property.type === "boolean")
    .map((property) => property.key)
    .join(",");

  return (
    <form className="stack" action={action}>
      <input type="hidden" name="serverId" value={serverId} />
      <input type="hidden" name="booleanKeys" value={booleanKeys} />

      {state.error ? <p className="notice notice-error">{state.error}</p> : null}

      {state.saved ? (
        <p className="notice">
          Gespeichert.
          {state.restartRequired
            ? " Minecraft liest die Datei nur beim Start — starte den Server neu, damit die Änderungen greifen."
            : ""}
        </p>
      ) : null}

      {state.rejected && state.rejected.length > 0 ? (
        <p className="notice notice-warn">
          Nicht übernommen: {state.rejected.join(", ")}. Diese Einstellungen
          gehören dem Panel.
        </p>
      ) : null}

      <div className="field-grid">
        {guided.map((property) => {
          const current = values[property.key] ?? "";
          const name = `prop.${property.key}`;

          if (property.type === "boolean") {
            return (
              <label className="checkbox" key={property.key}>
                <input
                  type="checkbox"
                  name={name}
                  value="true"
                  defaultChecked={current === "true"}
                />
                <span>
                  {property.label}
                  {property.hint ? (
                    <span className="hint">{property.hint}</span>
                  ) : null}
                </span>
              </label>
            );
          }

          return (
            <div className="field" key={property.key}>
              <label htmlFor={name}>{property.label}</label>

              {property.type === "select" ? (
                <select id={name} name={name} defaultValue={current}>
                  {property.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={name}
                  name={name}
                  type={property.type === "number" ? "number" : "text"}
                  defaultValue={current}
                />
              )}

              {property.hint ? (
                <span className="hint">{property.hint}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Wird gespeichert …" : "Einstellungen speichern"}
      </button>
    </form>
  );
}
