import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-sm font-semibold tracking-wide text-primary uppercase">
        BookWise
      </Link>
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm sm:p-8">{children}</div>
    </main>
  );
}
