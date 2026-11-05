"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Label + input + error text, wired together for screen readers. */
export function Field({
  label,
  name,
  error,
  hint,
  ...props
}: React.ComponentProps<"input"> & { label: string; name: string; error?: string; hint?: string }) {
  // useId keeps ids unique even when Next keeps a previous page mounted in the background.
  const id = `${React.useId()}-${name}`;
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
