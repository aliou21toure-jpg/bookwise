import * as React from "react";

import { cn } from "@/lib/utils";

/** A status message. `tone="error"` is announced immediately to screen readers. */
function Alert({ tone = "info", className, ...props }: React.ComponentProps<"div"> & { tone?: "info" | "error" | "success" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-slot="alert"
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
        tone === "success" && "border-success/40 bg-success/10 text-foreground",
        tone === "info" && "bg-muted text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Alert };
