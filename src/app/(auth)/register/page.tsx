"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { signUp } from "@/lib/auth-client";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error } = await signUp.email({ name, email, password });

    setPending(false);

    if (error) {
      setError(error.message ?? "Registrierung fehlgeschlagen.");
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <main className="centered">
        <div className="card card-narrow">
          <span className="eyebrow">Fast geschafft</span>
          <h1>Bestätige deine Adresse</h1>
          <p className="muted">
            Wir haben eine Mail an <code>{email}</code> geschickt. Öffne den Link
            darin, danach kannst du dich anmelden.
          </p>
          <p className="hint">
            In der Entwicklung wird nichts verschickt — der Link steht im
            Terminal, in dem <code>pnpm dev</code> läuft.
          </p>
          <Link className="btn btn-quiet" href="/login">
            Zur Anmeldung
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="centered">
      <div className="card card-narrow">
        <span className="eyebrow">Konto anlegen</span>
        <h1>Registrieren</h1>

        {error ? <p className="notice notice-error">{error}</p> : null}

        <form className="stack" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="email">E-Mail</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Passwort</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <span className="hint">Mindestens 10 Zeichen.</span>
          </div>

          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Wird angelegt …" : "Konto anlegen"}
          </button>
        </form>

        <p className="muted">
          Schon registriert? <Link href="/login">Anmelden</Link>
        </p>
      </div>
    </main>
  );
}
