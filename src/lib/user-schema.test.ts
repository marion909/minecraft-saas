import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  USER_MIN_PASSWORD_LENGTH,
  fieldErrors,
  userInputFromForm,
} from "./user-schema.ts";

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const base: Record<string, string> = {
    name: "Marion",
    email: "marion@example.com",
    password: "korrektes-pferd",
    role: "user",
    ...overrides,
  };

  for (const [key, value] of Object.entries(base)) {
    data.set(key, value);
  }
  return data;
}

describe("userInputFromForm", () => {
  it("nimmt eine gewöhnliche Eingabe an", () => {
    const parsed = userInputFromForm(form());
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.email, "marion@example.com");
    assert.equal(parsed.data?.role, "user");
  });

  it("normalisiert die Adresse vor der Prüfung", () => {
    // Sonst entstünden zwei Konten, die sich nur in der Schreibweise
    // unterscheiden — better-auth legt kleingeschrieben ab.
    const parsed = userInputFromForm(
      form({ email: "  Marion@Example.COM  " }),
    );
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.email, "marion@example.com");
  });

  it("weist eine Adresse ohne @ ab", () => {
    const parsed = userInputFromForm(form({ email: "marion.example.com" }));
    assert.equal(parsed.success, false);
    assert.ok(fieldErrors(parsed.error!).email);
  });

  it("weist ein zu kurzes Passwort ab", () => {
    const parsed = userInputFromForm(
      form({ password: "x".repeat(USER_MIN_PASSWORD_LENGTH - 1) }),
    );
    assert.equal(parsed.success, false);
    assert.ok(fieldErrors(parsed.error!).password);
  });

  it("nimmt ein Passwort genau an der Grenze an", () => {
    const parsed = userInputFromForm(
      form({ password: "x".repeat(USER_MIN_PASSWORD_LENGTH) }),
    );
    assert.equal(parsed.success, true);
  });

  it("weist einen zu kurzen Namen ab", () => {
    const parsed = userInputFromForm(form({ name: "M" }));
    assert.equal(parsed.success, false);
    assert.ok(fieldErrors(parsed.error!).name);
  });

  it("weist eine erfundene Rolle ab", () => {
    // Das Feld ist ein <select>, aber die Formulardaten kommen über HTTP —
    // wer will, schickt etwas anderes.
    const parsed = userInputFromForm(form({ role: "superadmin" }));
    assert.equal(parsed.success, false);
    assert.ok(fieldErrors(parsed.error!).role);
  });

  it("lässt admin zu", () => {
    const parsed = userInputFromForm(form({ role: "admin" }));
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.role, "admin");
  });

  it("meldet je Feld höchstens einen Fehler", () => {
    const parsed = userInputFromForm(
      form({ name: "", email: "nein", password: "kurz" }),
    );
    assert.equal(parsed.success, false);

    const errors = fieldErrors(parsed.error!);
    assert.deepEqual(Object.keys(errors).sort(), [
      "email",
      "name",
      "password",
    ]);
  });
});
