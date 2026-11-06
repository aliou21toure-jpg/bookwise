"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

import { useHydrated } from "@/components/auth/use-hydrated";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Intent {
  paymentId: string;
  provider: "stripe" | "fake";
  clientSecret: string;
  publishableKey: string | null;
}

/** After paying, the booking is confirmed by the webhook; refresh until it is. */
function useConfirmationPolling(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let n = 0;
    const id = setInterval(() => {
      router.refresh();
      if (++n >= 15) clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  }, [active, router]);
}

function StripeForm({ bookingId, label, onPaid }: { bookingId: string; label: string; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setPending(true);
    setError(null);
    // Card details go straight from Stripe's iframe to Stripe; BookWise never sees them.
    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/bookings/${bookingId}?paid=1` },
    });
    setPending(false);
    if (stripeError) setError(stripeError.message ?? "The payment did not go through.");
    else onPaid();
  }

  return (
    <form method="post" onSubmit={pay} className="grid gap-4">
      <PaymentElement />
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" size="lg" disabled={!stripe || pending}>
        {pending ? "Paying…" : label}
      </Button>
    </form>
  );
}

export function PaymentPanel({ bookingId, totalLabel }: { bookingId: string; totalLabel: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [paid, setPaid] = useState(false);
  useConfirmationPolling(paid);
  const stripePromise = useMemo(() => (intent?.provider === "stripe" && intent.publishableKey ? loadStripe(intent.publishableKey) : null), [intent]);

  async function start() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/v1/payments/create-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ bookingId }),
    });
    const json = await res.json();
    setPending(false);
    if (res.ok) setIntent(json.data);
    else setError(json.error?.message ?? "Payment could not start.");
  }

  async function simulate(outcome: "succeed" | "fail") {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/v1/payments/${intent!.paymentId}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    setPending(false);
    if (!res.ok) return setError("The simulated payment failed to run.");
    if (outcome === "fail") return setError("Your card was declined (simulated). Try again.");
    setPaid(true);
    router.refresh();
  }

  if (paid) return <Alert tone="success">Payment received. Confirming your booking…</Alert>;

  if (!intent) {
    return (
      <div className="grid gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Button size="lg" disabled={!hydrated || pending} onClick={start}>
          {pending ? "Starting payment…" : `Pay ${totalLabel}`}
        </Button>
      </div>
    );
  }

  if (intent.provider === "fake") {
    return (
      <div className="grid gap-3 rounded-xl border border-dashed p-4">
        <p className="text-sm">
          <strong>Test mode.</strong> This environment uses BookWise&rsquo;s local payment simulator; no card is charged.
        </p>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button size="lg" disabled={pending} onClick={() => simulate("succeed")}>
            Pay {totalLabel} with a test card
          </Button>
          <Button size="lg" variant="outline" disabled={pending} onClick={() => simulate("fail")}>
            Try a declined card
          </Button>
        </div>
      </div>
    );
  }

  return stripePromise ? (
    <Elements stripe={stripePromise} options={{ clientSecret: intent.clientSecret }}>
      <StripeForm bookingId={bookingId} label={`Pay ${totalLabel}`} onPaid={() => setPaid(true)} />
    </Elements>
  ) : (
    <Alert tone="error">Payments are not configured.</Alert>
  );
}
