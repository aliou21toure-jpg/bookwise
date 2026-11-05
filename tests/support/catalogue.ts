import * as listingRoute from "@/app/api/v1/listings/[id]/route";
import * as servicesRoute from "@/app/api/v1/listings/[id]/services/route";
import * as listingsRoute from "@/app/api/v1/listings/route";
import * as availabilityRoute from "@/app/api/v1/availability/route";
import { APP, call } from "./api";

export const LISTING = { category: "service", title: "Sports physiotherapy", description: "Assessment and treatment for sports injuries.", city: "Toronto" };
export const SERVICE = { name: "Initial assessment", durationMinutes: 60, priceMinor: 9500 };

export async function createListing(cookie: string, organizationId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await call<{ data: { id: string } }>(listingsRoute.POST, "POST", "/api/v1/listings", { cookie, body: { ...LISTING, organizationId, ...extra } });
  if (res.status !== 201) throw new Error(`create listing failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

export async function createService(cookie: string, listingId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await call<{ data: { id: string } }>(servicesRoute.POST, "POST", `/api/v1/listings/${listingId}/services`, {
    cookie,
    params: { id: listingId },
    body: { ...SERVICE, ...extra },
  });
  if (res.status !== 201) throw new Error(`create service failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

export async function publish(cookie: string, listingId: string): Promise<void> {
  const res = await call(listingRoute.PATCH, "PATCH", `/api/v1/listings/${listingId}`, { cookie, params: { id: listingId }, body: { status: "published" } });
  if (res.status !== 200) throw new Error(`publish failed: ${res.status} ${JSON.stringify(res.body)}`);
}

export async function addRule(cookie: string, serviceId: string, rule: Record<string, unknown>): Promise<string> {
  const res = await call<{ data: { id: string } }>(availabilityRoute.POST, "POST", "/api/v1/availability", { cookie, body: { serviceId, ...rule } });
  if (res.status !== 201) throw new Error(`rule failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

/** A published listing with one service, ready for search and availability tests. */
export async function publishedListing(cookie: string, organizationId: string, listing: Record<string, unknown> = {}, service: Record<string, unknown> = {}) {
  const listingId = await createListing(cookie, organizationId, listing);
  const serviceId = await createService(cookie, listingId, service);
  await publish(cookie, listingId);
  return { listingId, serviceId };
}

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** multipart/form-data upload through a route handler. */
export async function upload(handler: Handler, path: string, params: Record<string, string>, file: { bytes: Uint8Array; name: string; type: string } | null, cookie?: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const request = new Request(`${APP}${path}`, { method: "POST", body: form, headers: cookie ? { cookie } : {} });
  const res = await handler(request, { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
