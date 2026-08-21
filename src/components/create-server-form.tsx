"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  checkAddressAvailable,
  checkNameAvailable,
  createServer,
  type ServerFormState,
} from "@/app/(app)/servers/actions";

import { GAMES, DEFAULT_GAME, findGame } from "@/lib/games";

import {
  blocks,
  useAvailability,
  type AvailabilityState,
} from "./use-availability";

/**
 * Der Platz unter dem Feld zeigt genau eine Sache: erst den Hinweis, beim
 * Tippen den Stand der Prüfung, nach einem abgelehnten Abschicken die
 * Meldung vom Server. Nichts davon springt übereinander.
 */
function FieldStatus({
  state,
  serverError,
  hint,
}: {
  state: AvailabilityState;
  serverError?: string;
  hint: string;
}) {
  if (state.status === "prüft") {
    return <span className="hint">wird geprüft …</span>;
  }

  if (state.status === "fertig") {
    return state.result.state === "frei" ? (
      <span className="field-ok">frei</span>
    ) : (
      <span className="field-error">{state.result.reason}</span>
    );
  }

  if (serverError) {
    return <span className="field-error">{serverError}</span>;
  }

  return <span className="hint">{hint}</span>;
}

export type PlanChoice = {
  id: string;
  name: string;
  memoryMb: number;
  cpuCores: number;
  diskMb: number;
  maxPlayers: number;
  priceCents: number;
  /** Wie oft der Tarif noch auf den Node passt; 0 heißt belegt. */
  slots: number;
};

export function CreateServerForm({
  plans,
  baseDomain,
}: {
  plans: PlanChoice[];
  /** Basis aller Adressen; das Spielsegment kommt aus dem Katalog. */
  baseDomain: string;
}) {
  const [state, formAction, pending] = useActionState<ServerFormState, FormData>(
    createServer,
    {},
  );
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [planId, setPlanId] = useState(plans.find((p) => p.slots > 0)?.id ?? "");
  const [gameId, setGameId] = useState(DEFAULT_GAME);

  const game = findGame(gameId) ?? findGame(DEFAULT_GAME)!;

  // Die Adresse entsteht aus dem gewählten Spiel — das ist der Grund,
  // warum die Auswahl ganz oben steht und nicht bei der Software.
  const suffix = `.${game.slug}.${baseDomain}`;

  const nameState = useAvailability(name, checkNameAvailable);
  const addressState = useAvailability(subdomain, checkAddressAvailable);

  return (
    <form className="stack" action={formAction}>
      {state.error ? <p className="notice notice-error">{state.error}</p> : null}

      <div className="field">
        <label htmlFor="game">Spiel</label>
        <select
          id="game"
          name="game"
          value={gameId}
          onChange={(event) => setGameId(event.target.value)}
        >
          {GAMES.map((eintrag) => (
            <option key={eintrag.id} value={eintrag.id}>
              {eintrag.name}
              {eintrag.reife === "vorbereitet" ? " (neu)" : ""}
            </option>
          ))}
        </select>
        {state.fields?.game ? (
          <span className="field-error">{state.fields.game}</span>
        ) : (
          <span className="hint">
            Bestimmt Adresse, Ressourcenbedarf und Server-Software.
          </span>
        )}
      </div>

      {game.reife === "vorbereitet" ? (
        <p className="notice notice-warn">
          {game.name} ist eingerichtet, aber auf diesem Node noch nicht im
          Dauerbetrieb gelaufen. Rechne beim ersten Start mit Wartezeit — die
          Installation lädt rund {Math.round(game.installMb / 1024)} GB.
          {game.hinweis ? ` ${game.hinweis}` : ""}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          required
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={blocks(nameState) ? true : undefined}
        />
        <FieldStatus
          state={nameState}
          serverError={state.fields?.name}
          hint="Nur für dich, im Panel."
        />
      </div>

      <div className="field">
        <label htmlFor="subdomain">Adresse</label>
        <div className="addr">
          <input
            id="subdomain"
            name="subdomain"
            required
            value={subdomain}
            onChange={(event) =>
              setSubdomain(event.target.value.toLowerCase().replace(/\s/g, ""))
            }
            placeholder="meinserver"
            aria-invalid={blocks(addressState) ? true : undefined}
          />
          <span className="addr-suffix">{suffix}</span>
        </div>
        <FieldStatus
          state={addressState}
          serverError={state.fields?.subdomain}
          hint={
            game.routing === "hostname"
              ? "Unter dieser Adresse verbinden sich Spieler. Später nicht mehr änderbar."
              : `Dazu kommt ein Port, den dieser Server für sich allein bekommt — ` +
                `${game.name} kennt im Protokoll keinen Hostnamen, über den sich ` +
                `Server unterscheiden ließen. Die vollständige Adresse steht nach ` +
                `dem Anlegen auf der Serverseite.`
          }
        />
      </div>

      <fieldset className="fieldset">
        <legend>Tarif</legend>
        {state.fields?.planId ? (
          <span className="field-error">{state.fields.planId}</span>
        ) : null}

        <div className="choices">
          {plans.map((plan) => {
            const full = plan.slots <= 0;

            return (
              <label
                className={`choice${full ? " choice-disabled" : ""}`}
                key={plan.id}
              >
                <input
                  type="radio"
                  name="planId"
                  value={plan.id}
                  checked={planId === plan.id}
                  disabled={full}
                  onChange={() => setPlanId(plan.id)}
                  required
                />
                <span className="choice-body">
                  <span className="choice-head">
                    <strong>{plan.name}</strong>
                    {full ? (
                      <span className="chip chip-warn">belegt</span>
                    ) : (
                      <span className="chip">
                        {plan.priceCents === 0
                          ? "kostenlos"
                          : `${(plan.priceCents / 100).toFixed(2)} €`}
                      </span>
                    )}
                  </span>
                  <span className="hint">
                    {(plan.memoryMb / 1024).toFixed(0)} GB RAM ·{" "}
                    {plan.cpuCores} Kerne · {(plan.diskMb / 1024).toFixed(0)} GB
                    Speicher · {plan.maxPlayers} Spieler
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="field-grid">
        {/*
          Die Software-Frage gibt es nur, wo sie eine Antwort hat: Paper
          oder Vanilla ist eine Minecraft-Frage. Für Valheim wäre ein
          Pflichtfeld hier eine Hürde ohne Sinn.
        */}
        {game.variants ? (
          <div className="field">
            <label htmlFor="serverType">Server-Software</label>
            <select id="serverType" name="serverType" defaultValue={game.variants[0]?.id}>
              {game.variants.map((variante) => (
                <option key={variante.id} value={variante.id}>
                  {variante.label}
                  {variante.hint ? ` — ${variante.hint}` : ""}
                </option>
              ))}
            </select>
            {state.fields?.serverType ? (
              <span className="field-error">{state.fields.serverType}</span>
            ) : null}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="mcVersion">Version</label>
          <input id="mcVersion" name="mcVersion" defaultValue="LATEST" />
          <span className="hint">
            {game.id === "minecraft" ? (
              <>
                <code>LATEST</code> oder eine feste Version wie{" "}
                <code>1.21.8</code>. Die passende Java-Fassung wird daraus
                abgeleitet.
              </>
            ) : (
              <>
                <code>LATEST</code> lädt die aktuelle Fassung über Steam.
              </>
            )}
          </span>
        </div>
      </div>

      <div className="actions">
        <button
          className="btn btn-primary"
          type="submit"
          disabled={
            pending ||
            plans.every((plan) => plan.slots <= 0) ||
            blocks(nameState) ||
            blocks(addressState)
          }
        >
          {pending ? "Wird angelegt …" : "Server anlegen"}
        </button>
        <Link className="btn btn-quiet" href="/dashboard">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
