import Link from "next/link";

import { createNode } from "@/app/(app)/admin/nodes/actions";
import { EMPTY_NODE, NodeForm } from "@/components/node-form";
import { requireAdmin } from "@/lib/session";

export default async function NewNodePage() {
  await requireAdmin();

  return (
    <>
      <div>
        <span className="eyebrow">Verwaltung</span>
        <h1>Node hinzufügen</h1>
      </div>

      <p className="muted" style={{ maxWidth: "62ch" }}>
        Der Host muss vorher eingerichtet sein — Agent, Docker, Router und
        Speicher laufen dort, bevor dieser Eintrag Sinn ergibt. Der Weg dahin
        steht in <code>deploy/setup.sh</code>. Vor dem Speichern lohnt der
        Knopf „Verbindung prüfen“: Ein Tippfehler in Adresse oder Token fällt
        sonst erst dem ersten Nutzer auf.
      </p>

      <div className="card">
        <NodeForm
          action={createNode}
          defaults={EMPTY_NODE}
          submitLabel="Node anlegen"
        />
      </div>

      <p>
        <Link href="/admin/nodes">Zurück zur Übersicht</Link>
      </p>
    </>
  );
}
