"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      className="navlink"
      type="button"
      disabled={pending}
      style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
      onClick={async () => {
        setPending(true);
        await signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      {pending ? "…" : "Abmelden"}
    </button>
  );
}
