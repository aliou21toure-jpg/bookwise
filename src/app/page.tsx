import Link from "next/link";
import { CalendarCheck, ShieldCheck, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const pillars = [
  {
    icon: CalendarCheck,
    title: "Real-time availability",
    text: "Every slot shown is checked against live capacity, so a time you pick is a time you can book.",
  },
  {
    icon: Zap,
    title: "No double booking",
    text: "Reservations are allocated inside database transactions with row locks and integrity constraints.",
  },
  {
    icon: ShieldCheck,
    title: "Secure payments",
    text: "Card details never touch our servers. A booking is confirmed only after a verified payment.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-8 sm:px-6">
      <nav aria-label="Account" className="flex justify-end gap-2">
        <Button asChild variant="ghost">
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sign-up">Create account</Link>
        </Button>
      </nav>
      <section className="flex flex-col items-start gap-6">
        <p className="text-sm font-medium tracking-wide text-primary uppercase">BookWise</p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Book services and activities with confidence.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Find a provider, choose an available time, and pay securely. Providers manage listings, availability and
          reservations in one place.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button size="lg" disabled aria-describedby="coming-soon">
            Browse services
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/sign-up?type=provider">List your business</Link>
          </Button>
        </div>
        <p id="coming-soon" className="text-sm text-muted-foreground">
          Browsing and booking open soon. Providers can already create an account and set up their business.
        </p>
      </section>

      <section aria-labelledby="pillars" className="grid gap-4 sm:grid-cols-3">
        <h2 id="pillars" className="sr-only">
          How BookWise works
        </h2>
        {pillars.map(({ icon: Icon, title, text }) => (
          <Card key={title}>
            <CardHeader>
              <Icon aria-hidden className="mb-2 size-5 text-primary" />
              <CardTitle asChild>
                <h3>{title}</h3>
              </CardTitle>
              <CardDescription>{text}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </section>
    </main>
  );
}
