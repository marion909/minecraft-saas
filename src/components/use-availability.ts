"use client";

import { useEffect, useRef, useState } from "react";

import type { Availability } from "@/app/(app)/servers/actions";

export type AvailabilityState =
  | { status: "leer" }
  | { status: "prüft" }
  | { status: "fertig"; result: Availability };

/**
 * Fragt beim Tippen nach, ob ein Wert noch frei ist.
 *
 * Zwei Dinge, die dabei leicht schiefgehen und hier ausdrücklich behandelt
 * sind: Es wird nicht bei jedem Anschlag gefragt, sondern erst wenn eine
 * Weile nichts mehr kam. Und Antworten, die zu einer älteren Eingabe
 * gehören, werden verworfen — sonst überschriebe die Antwort auf „meinserv“
 * die auf „meinserver“, und am Feld stünde ein Urteil über einen Text, der
 * dort nicht mehr steht.
 */
export function useAvailability(
  value: string,
  check: (value: string) => Promise<Availability>,
  delayMs = 400,
): AvailabilityState {
  const [state, setState] = useState<AvailabilityState>({ status: "leer" });

  // Über eine Ref statt als Abhängigkeit: Bekäme der Effekt die Funktion
  // direkt, liefe er bei jedem Render erneut, sobald der Aufrufer sie
  // inline schreibt.
  const checkRef = useRef(check);
  checkRef.current = check;

  const ticket = useRef(0);

  useEffect(() => {
    const trimmed = value.trim();

    if (trimmed === "") {
      ticket.current += 1;
      setState({ status: "leer" });
      return;
    }

    setState({ status: "prüft" });

    const mine = ++ticket.current;
    const timer = setTimeout(() => {
      checkRef
        .current(trimmed)
        .then((result) => {
          if (mine === ticket.current) setState({ status: "fertig", result });
        })
        .catch(() => {
          // Netzfehler oder abgelaufene Sitzung: lieber nichts behaupten.
          // Das Anlegen prüft ohnehin noch einmal.
          if (mine === ticket.current) setState({ status: "leer" });
        });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return state;
}

/** Nur „belegt“ und „ungültig“ blockieren das Abschicken. */
export function blocks(state: AvailabilityState): boolean {
  return state.status === "fertig" && state.result.state !== "frei";
}
