/** Placeholder while a form that depends on the URL streams in. Deliberately not a form. */
export function FormSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <div aria-hidden className="grid gap-5">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="grid gap-2">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-10 rounded-md bg-muted" />
        </div>
      ))}
      <div className="h-10 rounded-md bg-muted" />
    </div>
  );
}
