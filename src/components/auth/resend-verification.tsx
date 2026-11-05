"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "./api-client";

export function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={state === "sending"}
        onClick={async () => {
          setState("sending");
          await api("/api/v1/auth/verification/resend", { body: { email } });
          setState("sent");
        }}
      >
        {state === "sending" ? "Sending…" : "Send the link again"}
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {state === "sent" ? "If the account still needs confirming, a new link is on its way." : ""}
      </p>
    </div>
  );
}
