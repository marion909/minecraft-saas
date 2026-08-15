import Link from "next/link";

/**
 * Die Registrierung ist abgeschaltet; Konten legt ein Admin unter
 * /admin/users an. Die Route bleibt trotzdem bestehen und erklärt sich,
 * statt mit 404 zu antworten — alte Lesezeichen und Links aus Mails
 * sollen irgendwo landen, wo der nächste Schritt steht.
 *
 * Der eigentliche Riegel sitzt nicht hier, sondern in auth.ts:
 * `disableSignUp` lässt POST /api/auth/sign-up/email abweisen.
 */
export default function RegisterPage() {
  return (
    <main className="centered">
      <div className="card card-narrow">
        <span className="eyebrow">Kein Selbstbedienungsladen</span>
        <h1>Registrierung geschlossen</h1>
        <p className="muted">
          Konten legt die Verwaltung an. Wenn du einen Zugang brauchst, frag
          die Person, die diesen Server betreibt — sie richtet dir einen ein
          und gibt dir Adresse und Passwort.
        </p>
        <Link className="btn btn-primary" href="/login">
          Zur Anmeldung
        </Link>
      </div>
    </main>
  );
}
