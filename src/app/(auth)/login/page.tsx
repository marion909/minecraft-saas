"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { signIn } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error } = await signIn.email({ email, password });

    if (error) {
      setPending(false);
      // Der Verifizierungsfall ist kein Fehler des Nutzers und braucht
      // einen anderen Hinweis als falsche Zugangsdaten.
      setError(
        error.status === 403
          ? "Deine E-Mail-Adresse ist noch nicht bestätigt. Sieh im Postfach nach."
          : "E-Mail oder Passwort stimmen nicht.",
      );
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="centered">
      <div className="card card-narrow">
        <span className="eyebrow">Willkommen zurück</span>
        <h1>Anmelden</h1>

        {error ? <p className="notice notice-error">{error}</p> : null}

        <form className="stack" onSubmit={onSubmit}>
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Wird geprüft …" : "Anmelden"}
          </button>
        </form>

        <p className="hint">
          Konten legt die Verwaltung an — eine Selbstregistrierung gibt es
          nicht.
        </p>
      </div>
    </main>
  );
}
