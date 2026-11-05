"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { api } from "./api-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await api("/api/v1/auth/logout", { body: {} });
        router.push("/sign-in");
        router.refresh();
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
