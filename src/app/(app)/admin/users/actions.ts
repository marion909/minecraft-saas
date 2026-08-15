"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin, ROLES } from "@/lib/roles";
import { requireAdmin } from "@/lib/session";
import { fieldErrors, userInputFromForm } from "@/lib/user-schema";

export type UserFormState = {
  error?: string;
  fields?: Record<string, string>;
};

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/**
 * Anlegen über das Admin-Plugin statt über die Registrierung.
 *
 * Der Unterschied ist nicht nur die fehlende Bestätigungsmail: `signUp`
 * würde eine Sitzung anlegen und dem Admin das Cookie des neuen Kontos
 * unterschieben. `createUser` legt nur den Datensatz an.
 */
export async function createUser(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const session = await requireAdmin();
  const parsed = userInputFromForm(formData);

  if (!parsed.success) {
    return { fields: fieldErrors(parsed.error) };
  }

  const existing = await db.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (existing) {
    return { fields: { email: "Diese Adresse ist bereits vergeben." } };
  }

  let userId: string;

  try {
    const created = await auth.api.createUser({
      headers: await headers(),
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        name: parsed.data.name,
        role: parsed.data.role,
      },
    });

    userId = created.user.id;
  } catch (error) {
    return { error: `Konto anlegen fehlgeschlagen: ${messageOf(error)}` };
  }

  // Vom Admin angelegte Konten gelten als bestätigt. Es gibt keine Mail,
  // die jemand öffnen könnte, und ohne dieses Flag käme das Konto wegen
  // requireEmailVerification nicht am Login vorbei.
  await db.user.update({
    where: { id: userId },
    data: { emailVerified: true },
  });

  await audit({
    action: "user.created",
    userId: session.user.id,
    meta: {
      createdUserId: userId,
      email: parsed.data.email,
      role: parsed.data.role,
      via: "admin",
    },
  });

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

/**
 * Rolle wechseln. Der letzte Admin lässt sich nicht herabstufen — sonst
 * käme niemand mehr in den Admin-Bereich, und die Rolle ist bewusst nur
 * über die Shell wiederherstellbar.
 */
export async function setUserRole(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  if (role !== ROLES.USER && role !== ROLES.ADMIN) {
    return { error: "Unbekannte Rolle." };
  }

  const target = await db.user.findUnique({ where: { id: userId } });

  if (!target) {
    return { error: "Dieses Konto gibt es nicht mehr." };
  }

  if (isAdmin(target.role) && role === ROLES.USER) {
    const admins = await db.user.count({ where: { role: ROLES.ADMIN } });

    if (admins <= 1) {
      return {
        error:
          "Das ist der letzte Admin. Erst einen weiteren ernennen, sonst " +
          "kommt niemand mehr in die Verwaltung.",
      };
    }
  }

  await db.user.update({ where: { id: userId }, data: { role } });

  await audit({
    action: "user.role.changed",
    userId: session.user.id,
    meta: { targetUserId: userId, from: target.role, to: role },
  });

  revalidatePath("/admin/users");
  return {};
}

/**
 * Konto löschen.
 *
 * Sitzungen, Anmeldedaten und Tarif-Zuordnungen gehen über Cascade mit.
 * Zwei Dinge bewusst nicht: Server hängen an Restrict, das Löschen wird
 * also verweigert, solange welche da sind — sonst verschwänden Welten
 * über eine Nebenwirkung. Und die Einträge im Prüfprotokoll bleiben
 * stehen, ihr Verweis wird auf NULL gesetzt; deshalb wandern Adresse und
 * ID hier ausdrücklich in den Eintrag, sonst wäre nachher nicht mehr
 * erkennbar, wen es betraf.
 */
export async function deleteUser(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");

  if (userId === session.user.id) {
    return { error: "Das eigene Konto lässt sich hier nicht löschen." };
  }

  const target = await db.user.findUnique({
    where: { id: userId },
    include: { _count: { select: { servers: true } } },
  });

  if (!target) {
    return { error: "Dieses Konto gibt es nicht mehr." };
  }

  // Der Fremdschlüssel steht auf Restrict, die Datenbank würde ohnehin
  // ablehnen. Hier abzufangen liefert einen Satz statt eines
  // Constraint-Fehlers — und sagt, was zu tun ist.
  if (target._count.servers > 0) {
    return {
      error:
        `„${target.name}“ hat noch ${target._count.servers} ` +
        `${target._count.servers === 1 ? "Server" : "Server"}. Erst die Server ` +
        `löschen — dabei werden Welten und Sicherungen entfernt, und das soll ` +
        `nicht als Nebenwirkung des Konto-Löschens passieren.`,
    };
  }

  if (isAdmin(target.role)) {
    const admins = await db.user.count({ where: { role: ROLES.ADMIN } });

    if (admins <= 1) {
      return {
        error:
          "Das ist der letzte Admin. Erst einen weiteren ernennen, sonst " +
          "kommt niemand mehr in die Verwaltung.",
      };
    }
  }

  await db.user.delete({ where: { id: userId } });

  await audit({
    action: "user.deleted",
    userId: session.user.id,
    meta: {
      deletedUserId: userId,
      email: target.email,
      name: target.name,
      role: target.role,
    },
  });

  revalidatePath("/admin/users");
  return {};
}
