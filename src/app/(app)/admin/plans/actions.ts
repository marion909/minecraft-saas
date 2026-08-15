"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { fieldErrors, planInputFromForm } from "@/lib/plan-schema";
import { requireAdmin } from "@/lib/session";

export type PlanFormState = {
  error?: string;
  fields?: Record<string, string>;
};

export async function createPlan(
  _previous: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  const session = await requireAdmin();
  const parsed = planInputFromForm(formData);

  if (!parsed.success) {
    return { fields: fieldErrors(parsed.error) };
  }

  const existing = await db.plan.findFirst({
    where: { OR: [{ slug: parsed.data.slug }, { name: parsed.data.name }] },
  });

  if (existing) {
    return {
      fields:
        existing.slug === parsed.data.slug
          ? { slug: "Diese Kennung ist bereits vergeben." }
          : { name: "Dieser Name ist bereits vergeben." },
    };
  }

  const plan = await db.plan.create({ data: parsed.data });

  await audit({
    action: "plan.created",
    userId: session.user.id,
    meta: { planId: plan.id, slug: plan.slug },
  });

  revalidatePath("/admin/plans");
  redirect("/admin/plans");
}

export async function updatePlan(
  planId: string,
  _previous: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  const session = await requireAdmin();
  const parsed = planInputFromForm(formData);

  if (!parsed.success) {
    return { fields: fieldErrors(parsed.error) };
  }

  const before = await db.plan.findUnique({ where: { id: planId } });

  if (!before) {
    return { error: "Diesen Tarif gibt es nicht mehr." };
  }

  const clash = await db.plan.findFirst({
    where: {
      id: { not: planId },
      OR: [{ slug: parsed.data.slug }, { name: parsed.data.name }],
    },
  });

  if (clash) {
    return {
      fields:
        clash.slug === parsed.data.slug
          ? { slug: "Diese Kennung ist bereits vergeben." }
          : { name: "Dieser Name ist bereits vergeben." },
    };
  }

  await db.plan.update({ where: { id: planId }, data: parsed.data });

  // Server behalten ihre bereits angewandten Werte, bis sie neu erstellt
  // werden — sonst liefen Buchhaltung und Container auseinander.
  const affected = await db.server.count({ where: { planId } });

  await audit({
    action: "plan.updated",
    userId: session.user.id,
    meta: {
      planId,
      slug: parsed.data.slug,
      affectedServers: affected,
      memoryMbBefore: before.memoryMb,
      memoryMbAfter: parsed.data.memoryMb,
    },
  });

  revalidatePath("/admin/plans");
  redirect("/admin/plans");
}

export async function deletePlan(
  _previous: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  const session = await requireAdmin();
  const planId = String(formData.get("planId") ?? "");

  const plan = await db.plan.findUnique({
    where: { id: planId },
    include: { _count: { select: { servers: true, subscriptions: true } } },
  });

  if (!plan) {
    return { error: "Diesen Tarif gibt es nicht mehr." };
  }

  // Der Fremdschlüssel steht auf Restrict, die Datenbank würde also ohnehin
  // ablehnen. Hier abzufangen liefert dem Admin eine erklärende Meldung
  // statt eines Constraint-Fehlers.
  if (plan._count.servers > 0) {
    return {
      error:
        `"${plan.name}" wird von ${plan._count.servers} Server(n) genutzt und kann nicht ` +
        `gelöscht werden. Setze ihn stattdessen auf nicht öffentlich, dann ist er für ` +
        `neue Bestellungen weg und bestehende Server laufen weiter.`,
    };
  }

  if (plan._count.subscriptions > 0) {
    return {
      error: `"${plan.name}" hat ${plan._count.subscriptions} laufende Zuordnung(en) und kann nicht gelöscht werden.`,
    };
  }

  await db.plan.delete({ where: { id: planId } });

  await audit({
    action: "plan.deleted",
    userId: session.user.id,
    meta: { planId, slug: plan.slug, name: plan.name },
  });

  revalidatePath("/admin/plans");
  redirect("/admin/plans");
}
