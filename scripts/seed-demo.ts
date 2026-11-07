/**
 * Fills a development database with demo data, entirely through the public API handlers, so
 * every row passes the same validation, permissions and row-level security as real traffic.
 *
 *   npm run seed:demo
 *
 * Creates three providers with published listings and weekly hours, two customers with a few
 * confirmed bookings (paid ones through the local payment simulator), and an administrator. All accounts share DEMO_PASSWORD. Refuses to run
 * in production or when the demo accounts already exist.
 */
import { getPool } from "@/db";
import { ownerQuery } from "../tests/support/db";
import {
  addRule,
  createService,
  publishedListing,
} from "../tests/support/catalogue";
import { checkout, hold, openSlots } from "../tests/support/bookings";
import { createIntent, simulate } from "../tests/support/payments";
import {
  PASSWORD,
  createAdmin,
  createProvider,
  createUser,
} from "../tests/support/users";

export const DEMO_PASSWORD = PASSWORD;

const PROVIDERS = [
  {
    email: "maple.physio@demo.bookwise.dev",
    organization: {
      name: "Maple Physio",
      timezone: "America/Toronto",
      defaultCurrency: "CAD",
    },
    listing: {
      category: "service",
      title: "Sports physiotherapy",
      description:
        "Assessment and treatment for running and sports injuries, close to Union Station.",
      city: "Toronto",
    },
    services: [
      { name: "Initial assessment", durationMinutes: 60, priceMinor: 9500 },
      {
        name: "Follow-up session",
        durationMinutes: 30,
        priceMinor: 6000,
        requiresApproval: true,
      },
    ],
    hours: { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
  },
  {
    email: "studio.lumiere@demo.bookwise.dev",
    organization: {
      name: "Studio Lumière",
      timezone: "America/Montreal",
      defaultCurrency: "CAD",
    },
    listing: {
      category: "activity",
      title: "Morning vinyasa yoga",
      description:
        "An all-levels flow class in a sunlit Plateau studio. Mats provided.",
      city: "Montreal",
    },
    services: [
      {
        name: "Drop-in class",
        durationMinutes: 60,
        priceMinor: 2200,
        capacity: 12,
        maxPerBooking: 2,
      },
    ],
    hours: { weekdays: [0, 1, 2, 3, 4, 5, 6], start: "07:00", end: "10:00" },
  },
  {
    email: "harbour.desks@demo.bookwise.dev",
    organization: {
      name: "Harbour Desks",
      timezone: "America/Vancouver",
      defaultCurrency: "CAD",
    },
    listing: {
      category: "service",
      title: "Quiet meeting room for six",
      description:
        "Screen, whiteboard and coffee included. Two minutes from Waterfront station.",
      city: "Vancouver",
    },
    services: [{ name: "Room, one hour", durationMinutes: 60, priceMinor: 0 }],
    hours: { weekdays: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" },
  },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("seed:demo is for development databases only.");
  if (process.env.MAIL_TRANSPORT !== "memory")
    throw new Error(
      "Run through `npm run seed:demo` (it needs MAIL_TRANSPORT=memory).",
    );
  const existing = await ownerQuery<{ n: number }>(
    "select count(*)::int as n from bookwise.users where email like '%@demo.bookwise.dev'",
  );
  if (existing[0]!.n > 0)
    throw new Error(
      "Demo accounts already exist. Reset the database first (npm run db:migrate on a fresh database).",
    );

  const services: string[] = [];
  for (const p of PROVIDERS) {
    const provider = await createProvider(p.email, p.organization);
    let listingId: string | undefined;
    for (const [i, service] of p.services.entries()) {
      if (i === 0) {
        const created = await publishedListing(
          provider.cookie,
          provider.orgId,
          p.listing,
          service,
        );
        listingId = created.listingId;
        services.push(created.serviceId);
        for (const weekday of p.hours.weekdays)
          await addRule(provider.cookie, created.serviceId, {
            weekday,
            startLocal: p.hours.start,
            endLocal: p.hours.end,
            validFrom: "2026-01-01",
          });
      } else {
        const serviceId = await createService(
          provider.cookie,
          listingId!,
          service,
        );
        for (const weekday of p.hours.weekdays)
          await addRule(provider.cookie, serviceId, {
            weekday,
            startLocal: p.hours.start,
            endLocal: p.hours.end,
            validFrom: "2026-01-01",
          });
      }
    }
    console.log(`provider  ${p.email}  (${p.organization.name})`);
  }

  const customers = [
    await createUser("amina@demo.bookwise.dev"),
    await createUser("jonas@demo.bookwise.dev"),
  ];
  for (const c of customers) console.log(`customer  ${c.email}`);

  // Confirmed bookings on the free meeting room (paid services need a card at checkout, which
  // is the part worth trying by hand).
  const room = services[2]!;
  const slots = await openSlots(room, 2);
  let confirmed = 0;
  for (const [i, customer] of customers.entries()) {
    for (const startsAt of [slots[i * 3]!, slots[i * 3 + 1]!]) {
      const res = await hold(customer.cookie, { serviceId: room, startsAt });
      if (res.status !== 201)
        throw new Error(
          `hold failed: ${res.status} ${JSON.stringify(res.body)}`,
        );
      const done = await checkout(customer.cookie, res.body.data.id);
      if (done.status >= 300)
        throw new Error(
          `checkout failed: ${done.status} ${JSON.stringify(done.body)}`,
        );
      confirmed++;
    }
  }

  // Paid physiotherapy and yoga bookings, paid through the local payment simulator.
  if (process.env.PAYMENT_PROVIDER === "fake") {
    for (const serviceId of [services[0]!, services[1]!]) {
      const open = await openSlots(serviceId, 1);
      for (const [i, customer] of customers.entries()) {
        for (const startsAt of [open[i * 2]!, open[i * 2 + 5]!]) {
          const res = await hold(customer.cookie, { serviceId, startsAt });
          if (res.status !== 201)
            throw new Error(
              `hold failed: ${res.status} ${JSON.stringify(res.body)}`,
            );
          const intent = await createIntent(customer.cookie, res.body.data.id);
          if (intent.status !== 201)
            throw new Error(
              `payment failed: ${intent.status} ${JSON.stringify(intent.body)}`,
            );
          const paid = await simulate(
            customer.cookie,
            intent.body.data.paymentId,
          );
          if (paid.status !== 200)
            throw new Error(
              `payment failed: ${paid.status} ${JSON.stringify(paid.body)}`,
            );
          confirmed++;
        }
      }
    }
  }
  console.log(`bookings  ${confirmed} confirmed`);

  const admin = await createAdmin("admin@demo.bookwise.dev");
  console.log(`admin     ${admin.email}`);
  console.log(
    `\nEvery demo account signs in with the password: ${DEMO_PASSWORD}`,
  );
}

main()
  .then(() => getPool().end())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
