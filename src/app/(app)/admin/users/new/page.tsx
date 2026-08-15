import { UserForm } from "@/components/user-form";
import { requireAdmin } from "@/lib/session";

import { createUser } from "../actions";

export default async function NewUserPage() {
  await requireAdmin();

  return (
    <>
      <div>
        <span className="eyebrow">Konten</span>
        <h1>Neues Konto</h1>
      </div>

      <div className="card" style={{ maxWidth: "40rem" }}>
        <p className="muted">
          Das Konto ist sofort benutzbar — es wird keine Bestätigungsmail
          verschickt und keine erwartet. Gib Adresse und Passwort weiter,
          danach kann sich die Person anmelden.
        </p>
        <UserForm action={createUser} />
      </div>
    </>
  );
}
