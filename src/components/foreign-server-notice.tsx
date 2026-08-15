import Link from "next/link";

/**
 * Hinweis, dass dieser Server jemand anderem gehört.
 *
 * Admins sehen fremde Server in derselben Ansicht wie ihre eigenen — mit
 * Konsole, Dateimanager und Löschknopf. Ohne einen sichtbaren Unterschied
 * ist der einzige Anhaltspunkt der Servername, und der reicht nicht: Wer
 * aus der Übersicht heraus drei Server nacheinander öffnet, hat nach dem
 * zweiten Wechsel keine Gewissheit mehr, in wessen Welt er gerade steht.
 */
export function ForeignServerNotice({
  owner,
}: {
  owner: { id: string; name: string; email: string };
}) {
  return (
    <p className="notice notice-warn">
      Dieser Server gehört <strong>{owner.name}</strong> (<code>{owner.email}</code>
      ). Du siehst ihn als Admin — Änderungen, Befehle und Löschungen treffen
      ein fremdes Konto.{" "}
      <Link href={`/admin/servers?q=${encodeURIComponent(owner.email)}`}>
        Alle Server dieses Kontos
      </Link>
    </p>
  );
}
