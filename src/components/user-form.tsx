"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import type { UserFormState } from "@/app/(app)/admin/users/actions";
import { ROLES } from "@/lib/roles";
import { USER_MIN_PASSWORD_LENGTH } from "@/lib/user-schema";

/**
 * Ein Passwort, das der Admin nicht selbst ausdenken muss. Läuft im
 * Browser über die Web-Crypto-API — der Wert entsteht also nie auf dem
 * Server und landet in keinem Log.
 */
function suggestPassword(): string {
  // Ohne l, I, O, 0 und 1: Das Passwort wird vorgelesen oder abgetippt.
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(20);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
}

export function UserForm({
  action,
}: {
  action: (
    previous: UserFormState,
    formData: FormData,
  ) => Promise<UserFormState>;
}) {
  const [state, formAction, pending] = useActionState<UserFormState, FormData>(
    action,
    {},
  );
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);

  return (
    <form action={formAction} className="stack">
      {state.error ? (
        <p className="notice notice-error">{state.error}</p>
      ) : null}

      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          autoComplete="off"
          required
          aria-invalid={state.fields?.name ? true : undefined}
          aria-describedby={state.fields?.name ? "name-error" : undefined}
        />
        {state.fields?.name ? (
          <span className="field-error" id="name-error">
            {state.fields.name}
          </span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="email">E-Mail</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="off"
          required
          aria-invalid={state.fields?.email ? true : undefined}
          aria-describedby={state.fields?.email ? "email-error" : undefined}
        />
        {state.fields?.email ? (
          <span className="field-error" id="email-error">
            {state.fields.email}
          </span>
        ) : (
          <span className="hint">
            Wird als Anmeldename verwendet und gilt sofort als bestätigt.
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="password">Passwort</label>
        <input
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={USER_MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={state.fields?.password ? true : undefined}
          aria-describedby={
            state.fields?.password ? "password-error" : undefined
          }
        />
        {state.fields?.password ? (
          <span className="field-error" id="password-error">
            {state.fields.password}
          </span>
        ) : (
          <span className="hint">
            Mindestens {USER_MIN_PASSWORD_LENGTH} Zeichen. Gib es der Person
            weiter — sie kann es später selbst ändern.
          </span>
        )}
        <div className="actions">
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => {
              setPassword(suggestPassword());
              setVisible(true);
            }}
          >
            Vorschlagen
          </button>
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? "Verbergen" : "Anzeigen"}
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="role">Rolle</label>
        <select id="role" name="role" defaultValue={ROLES.USER}>
          <option value={ROLES.USER}>Nutzer</option>
          <option value={ROLES.ADMIN}>Admin</option>
        </select>
        {state.fields?.role ? (
          <span className="field-error">{state.fields.role}</span>
        ) : (
          <span className="hint">
            Admins sehen die Verwaltung und alle Server, nicht nur die eigenen.
          </span>
        )}
      </div>

      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Wird angelegt …" : "Konto anlegen"}
        </button>
        <Link className="btn btn-quiet" href="/admin/users">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
