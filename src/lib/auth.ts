import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";

import { db } from "./db";
import { env } from "./env";
import { sendMail } from "./mail";
import { ROLES } from "./roles";

export const auth = betterAuth({
  appName: "Minecraft SaaS",
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  emailAndPassword: {
    enabled: true,
    // Ohne verifizierte Adresse kein Server: das ist der erste und
    // billigste Riegel gegen massenhaft angelegte Wegwerf-Accounts.
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
