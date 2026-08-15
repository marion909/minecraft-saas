/**
 * better-auth erwartet Rollen als Strings, deshalb kein Prisma-Enum.
 * Die gültigen Werte stehen dafür hier an einer Stelle.
 */
export const ROLES = {
  USER: "user",
  ADMIN: "admin",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export function isAdmin(role: string | null | undefined): boolean {
  return role === ROLES.ADMIN;
}
