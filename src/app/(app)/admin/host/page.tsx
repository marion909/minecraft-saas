import Link from "next/link";

import { ServerStatus } from "@/generated/prisma/enums";
import { HostPowerForm } from "@/components/host-power-form";
import { AgentClient, type AgentHostInfo } from "@/lib/agent";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { formatMb, formatUptime } from "@/lib/status-label";

/**
 * Läuft das Panel vermutlich auf demselben Host?
 *
 * Sicher wissen lässt sich das von hier aus nicht. Die Adresse des
 * Agents ist der beste Anhaltspunkt: Zeigt sie auf die Loopback-Adresse,
 * sprechen Panel und Agent über dieselbe Maschine — dann nimmt ein
 * Neustart auch dieses Panel mit, und das gehört auf den Bildschirm,
 * bevor jemand drückt.
 */
function panelLikelyOnNode(agentUrl: string): boolean {
  try {
    const host = new URL(agentUrl).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function Kennzahl({ label, value }: { label: string; value: string }) {
  return (
    <div className="kennzahl">
      <span className="kennzahl-label">{label}</span>
      <span className="kennzahl-wert">{value}</span>
    </div>
  );
}

function HostDetails({ info }: { info: AgentHostInfo }) {
  const belegt = info.memory.totalMb - info.memory.availableMb;
  const [load1] = info.loadAverage;

  return (
    <>
      <div className="kennzahlen">
        <Kennzahl label="Rechnername" value={info.hostname} />
        <Kennzahl label="Läuft seit" value={formatUptime(info.uptimeSeconds)} />
        <Kennzahl
          label="Last (1 Min.)"
          value={`${load1.toFixed(2)} bei ${info.cpuCount} Kernen`}
        />
        <Kennzahl
          label="Arbeitsspeicher"
          value={`${formatMb(belegt)} von ${formatMb(info.memory.totalMb)} belegt`}
        />
        {info.disk ? (
          <Kennzahl
            label="Speicherplatz"
            value={`${formatMb(info.disk.freeMb)} frei von ${formatMb(info.disk.totalMb)}`}
          />
        ) : null}
        <Kennzahl
          label="Container"
          value={`${info.containers.running} von ${info.containers.total} laufen`}
        />
      </div>

      <p className="hint">
        Kernel: {info.kernel}
        {info.memory.source === "os"
          ? " · Speicherwerte ohne /proc — auf diesem System nur grob"
          : ""}
        {info.disk ? ` · gemessen an ${info.disk.path}` : ""}
      </p>

      {load1 > info.cpuCount * 2 ? (
        <p className="notice notice-warn">
          Die Last liegt deutlich über der Kernzahl. Auf einem Host mit
          Minecraft-Servern heißt das meist: Jemand generiert gerade Welt,
          oder ein Server hat zu wenig Arbeitsspeicher und die JVM räumt
          durchgehend auf.
        </p>
      ) : null}

      {info.rebootRequired.required ? (
        <p className="notice notice-warn">
          <strong>Ein Neustart steht aus.</strong> Ein Paketupdate verlangt
          ihn — fast immer ein Kernel, damit auch die Sicherheitskorrekturen
          darin wirksam werden.
          {info.rebootRequired.packages.length > 0 ? (
            <>
              {" "}
              Betroffen: <code>{info.rebootRequired.packages.join(", ")}</code>
            </>
          ) : null}
        </p>
      ) : null}

      {info.busy.length > 0 ? (
        <p className="notice notice-warn">
          Auf diesem Host laufen gerade {info.busy.length} Vorgänge (
          {info.busy.map((task) => task.kind).join(", ")}). Solange die laufen,
          weist der Agent einen Neustart ab — ein Backup, das mittendrin
          abbricht, lässt den Server im Zustand <code>save-off</code> zurück.
        </p>
      ) : null}
    </>
  );
}

export default async function HostPage() {
  await requireAdmin();

  const nodes = await db.node.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      servers: { select: { id: true, status: true } },
    },
  });

  const infos = await Promise.all(
    nodes.map((node) =>
      AgentClient.forNode(node)
        .hostInfo()
        .then((info) => ({ ok: true as const, info }))
        .catch((error: unknown) => ({
          ok: false as const,
          reason: error instanceof Error ? error.message : "Nicht erreichbar.",
        })),
    ),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Verwaltung</span>
          <h1>Host</h1>
        </div>
        <Link className="btn btn-quiet" href="/admin/nodes">
          Nodes verwalten
        </Link>
      </div>

      <p className="muted" style={{ maxWidth: "62ch" }}>
        Zustand der Maschinen hinter dem Panel — und der einzige Weg, sie aus
        der Oberfläche zu schalten, ohne die Welten zu beschädigen.
      </p>

      {nodes.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Kein Node eingetragen.</p>
          <Link className="btn btn-primary" href="/admin/nodes/new">
            Node hinzufügen
          </Link>
        </div>
      ) : (
        nodes.map((node, index) => {
          const state = infos[index];
          const running = node.servers.filter(
            (server) => server.status === ServerStatus.RUNNING,
          ).length;

          return (
            <div className="card" key={node.id}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <h2 style={{ fontSize: "1.15rem", margin: 0 }}>{node.name}</h2>
                <span className="chip">{node.status}</span>
              </div>

              {state?.ok ? (
                <>
                  <HostDetails info={state.info} />

                  <div className="danger-zone" style={{ marginTop: "1.25rem" }}>
                    <h3 style={{ fontSize: "1rem" }}>Schalten</h3>
                    <HostPowerForm
                      nodeId={node.id}
                      nodeName={node.name}
                      runningServers={running}
                      canPower={state.info.canPower}
                      powerError={state.info.powerError}
                      panelLikelyHere={panelLikelyOnNode(node.agentUrl)}
                    />
                  </div>
                </>
              ) : (
                <p className="notice notice-error">
                  Der Agent auf <code>{node.agentUrl}</code> antwortet nicht:{" "}
                  {state?.reason} Ohne ihn lässt sich der Host von hier weder
                  ablesen noch schalten — dann bleibt nur SSH.
                </p>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
