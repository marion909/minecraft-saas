import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";

import { db } from "./db";
import { env } from "./env";
import { sendMail } from "./mail";
import { ROLES } from "./roles";

export const auth = betterAuth({
  appName: "Gaming Server SaaS",
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  emailAndPassword: {
    enabled: true,

    // Konten entstehen nur im Admin-Bereich. Das hier ist der Riegel, der
    // wirklich zählt: Die Seite /register zu entfernen genügt nicht,
    // solange POST /api/auth/sign-up/email antwortet — den Endpunkt kennt
    // jeder, der schon einmal better-auth gesehen hat.
    disableSignUp: true,

    // Bleibt gesetzt, obwohl niemand mehr eine Bestätigungsmail bekommt:
    // Fällt disableSignUp irgendwann wieder, ist die Sperre noch da.
    // Vom Admin angelegte Konten setzen emailVerified selbst.
    requireEmailVerification: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Bestätige deine E-Mail-Adresse",
        text: [
          `Hallo${user.name ? ` ${user.name}` : ""},`,
          "",
          "bestätige deine Adresse über diesen Link:",
          url,
          "",
          "Der Link gilt eine Stunde.",
        ].join("\n"),
      });
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
  },

  plugins: [
    admin({
      defaultRole: ROLES.USER,
      adminRoles: [ROLES.ADMIN],
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
