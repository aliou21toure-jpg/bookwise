import "server-only";

import { env } from "@/lib/env";
import { fakeGateway } from "./fake-gateway";
import type { PaymentGateway } from "./gateway";
import { stripeGateway } from "./stripe-gateway";

let instance: PaymentGateway | undefined;

export function gateway(): PaymentGateway {
  if (!instance) {
    const config = env();
    instance =
      config.PAYMENT_PROVIDER === "stripe"
        ? stripeGateway(config.STRIPE_SECRET_KEY!, config.STRIPE_WEBHOOK_SECRET!)
        : fakeGateway();
  }
  return instance;
}

/** Tests only: replace the gateway (for example with a Stripe client stub). */
export function setGatewayForTests(g: PaymentGateway | undefined): void {
  instance = g;
}
