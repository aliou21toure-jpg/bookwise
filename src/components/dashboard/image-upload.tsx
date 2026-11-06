"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { useHydrated } from "@/components/auth/use-hydrated";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Upload one listing image (JPEG, PNG or WebP, at most 5 MB; the server checks the bytes). */
export function ImageUpload({ listingId }: { listingId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose an image first.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Images can be at most 5 MB.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch(`/api/v1/listings/${listingId}/images`, { method: "POST", body: data }).catch(() => null);
    setPending(false);
    if (!res?.ok) {
      const json = await res?.json().catch(() => null);
      setError(json?.error?.message ?? "The upload failed. Try again.");
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form method="post" encType="multipart/form-data" onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-file`} className="text-sm font-medium">
          Image
        </label>
        <input id={`${id}-file`} name="file" type="file" accept="image/jpeg,image/png,image/webp" className="w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5" />
      </div>
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-alt`} className="text-sm font-medium">
          Description for screen readers
        </label>
        <input id={`${id}-alt`} name="altText" maxLength={200} className="h-9 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
      </div>
      <Button type="submit" disabled={!hydrated || pending}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
      {error && (
        <Alert tone="error" className="sm:col-span-3">
          {error}
        </Alert>
      )}
    </form>
  );
}
