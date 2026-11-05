import { describe, expect, it } from "vitest";

import { sniffImageType } from "@/modules/listings/images";
import { decideCatalogueAccess, decideListingStatusChange, type ListingStatus } from "@/modules/listings/listings.policies";
import { CreateServiceBody, SearchQuery, UpdateListingBody } from "@/modules/listings/listings.schemas";
import { AvailabilityQuery, CreatePeriodBody, CreateRuleBody } from "@/modules/availability/availability.schemas";

describe("decideCatalogueAccess", () => {
  it.each([
    ["manage.read", "provider", null, "active", "not_found"],
    ["manage.write", "customer", null, "active", "not_found"],
    ["manage.read", "admin", null, "active", "allow"],
    ["manage.write", "admin", null, "active", "forbidden"],
    ["manage.write", "provider", "staff", "active", "allow"],
    ["manage.write", "provider", "owner", "suspended", "suspended"],
    ["manage.read", "provider", "staff", "suspended", "allow"],
  ] as const)("%s by %s (member: %s, org %s) -> %s", (action, userRole, memberRole, orgStatus, expected) => {
    expect(decideCatalogueAccess(action, { userRole, memberRole, orgStatus })).toBe(expected);
  });
});

describe("decideListingStatusChange", () => {
  const facts = { activeServices: 1, archived: false };
  const states: ListingStatus[] = ["draft", "published", "under_review", "rejected"];

  it("lets members move only between draft and published", () => {
    for (const from of states)
      for (const to of states) {
        const result = decideListingStatusChange(from, to, "member", facts);
        const allowed = from === to || (["draft", "published"].includes(from) && ["draft", "published"].includes(to));
        expect(result.ok, `${from} -> ${to}`).toBe(allowed);
      }
  });

  it("lets administrators set any state", () => {
    for (const from of states) for (const to of states) expect(decideListingStatusChange(from, to, "admin", facts).ok).toBe(true);
  });

  it("requires an active service to publish, for everyone", () => {
    expect(decideListingStatusChange("draft", "published", "member", { activeServices: 0, archived: false })).toMatchObject({ ok: false, code: "PUBLISH_REQUIREMENTS" });
    expect(decideListingStatusChange("rejected", "published", "admin", { activeServices: 0, archived: false })).toMatchObject({ ok: false });
  });

  it("freezes archived listings", () => {
    expect(decideListingStatusChange("draft", "published", "admin", { activeServices: 3, archived: true })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });
});

describe("sniffImageType", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  const text = (s: string) => new TextEncoder().encode(s);
  it("recognises JPEG, PNG and WebP by their first bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImageType(text("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it.each(["<svg xmlns='http://www.w3.org/2000/svg'/>", "GIF89a", "<!doctype html>", "RIFF\0\0\0\0WAVE", "%PDF-1.7", ""])("rejects %j", (s) => {
    expect(sniffImageType(text(s))).toBeNull();
  });
});

describe("catalogue input", () => {
  it("only accepts whole minor units for prices", () => {
    expect(CreateServiceBody.safeParse({ name: "Class", durationMinutes: 60, priceMinor: 1999 }).success).toBe(true);
    expect(CreateServiceBody.safeParse({ name: "Class", durationMinutes: 60, priceMinor: 19.99 }).success).toBe(false);
    expect(CreateServiceBody.safeParse({ name: "Class", durationMinutes: 60, priceMinor: 1999, currency: "USD" }).success).toBe(false);
  });

  it("lets members request only draft or published", () => {
    expect(UpdateListingBody.safeParse({ status: "published" }).success).toBe(true);
    expect(UpdateListingBody.safeParse({ status: "rejected" }).success).toBe(false);
  });

  it("bounds search paging and price filters", () => {
    expect(SearchQuery.parse({})).toMatchObject({ page: 1, pageSize: 12, sort: "relevance" });
    expect(SearchQuery.safeParse({ pageSize: "51" }).success).toBe(false);
    expect(SearchQuery.safeParse({ minPrice: "10.5" }).success).toBe(false);
  });

  it("validates opening hours and closures", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(CreateRuleBody.safeParse({ serviceId: id, weekday: 1, startLocal: "24:00", endLocal: "25:00" }).success).toBe(false);
    expect(CreateRuleBody.safeParse({ serviceId: id, weekday: 1, startLocal: "09:00", endLocal: "17:30" }).success).toBe(true);
    expect(CreatePeriodBody.safeParse({ organizationId: id, startsAt: "2027-01-02T00:00:00Z", endsAt: "2027-01-01T00:00:00Z" }).success).toBe(false);
    expect(CreatePeriodBody.safeParse({ organizationId: id, startsAt: "2027-01-01T00:00:00Z", endsAt: "2028-06-01T00:00:00Z" }).success).toBe(false);
  });

  it("defaults availability to the next 7 days and caps it at 31", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const parsed = AvailabilityQuery.parse({ serviceId: id, from: "2027-01-01T00:00:00Z" });
    expect(parsed.to.toISOString()).toBe("2027-01-08T00:00:00.000Z");
    expect(AvailabilityQuery.safeParse({ serviceId: id, from: "2027-01-01T00:00:00Z", to: "2027-02-02T00:00:01Z" }).success).toBe(false);
  });
});
