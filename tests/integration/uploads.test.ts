import { readdirSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import * as imageRoute from "@/app/api/v1/listings/[id]/images/[imageId]/route";
import * as imagesRoute from "@/app/api/v1/listings/[id]/images/route";
import * as mediaRoute from "@/app/api/v1/media/[orgId]/[file]/route";
import { getPool } from "@/db";
import { clearOutbox } from "@/lib/mail/mailer";
import { APP, call } from "../support/api";
import { createListing, upload } from "../support/catalogue";
import { ownerQuery, truncateAuthTables } from "../support/db";
import { createProvider } from "../support/users";

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterAll(() => getPool().end());

async function setup() {
  const p = await createProvider("p@example.com");
  const listingId = await createListing(p.cookie, p.orgId);
  const send = (bytes: Uint8Array, name: string, type: string, cookie: string = p.cookie, extra: Record<string, string> = {}) =>
    upload(imagesRoute.POST, `/api/v1/listings/${listingId}/images`, { id: listingId }, { bytes, name, type }, cookie, extra);
  return { p, listingId, send };
}

const media = async (url: string) => {
  const [, , , , orgId, file] = url.split("/");
  return mediaRoute.GET(new Request(`${APP}${url}`), { params: Promise.resolve({ orgId: orgId!, file: file! }) });
};

describe("accepted images", () => {
  it("re-encodes a JPEG to WebP, strips EXIF (including GPS) and serves it safely", async () => {
    const { send } = await setup();
    const withGps = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } })
      .jpeg()
      .withExif({ IFD0: { Make: "SecretCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "45/1 30/1 0/1" } })
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const res = await send(withGps, "holiday.jpg", "image/jpeg", undefined, { altText: "Treatment room" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ width: 64, height: 48, altText: "Treatment room" });

    const served = await media(res.body.data.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    const meta = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
  });

  it("accepts PNG and WebP and shrinks anything larger than 2000 px", async () => {
    const { send } = await setup();
    const png = await sharp({ create: { width: 2600, height: 1300, channels: 4, background: "#00f8" } }).png().toBuffer();
    const webp = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#0f0" } }).webp().toBuffer();
    const big = await send(png, "wide.png", "image/png");
    expect(big.status).toBe(201);
    expect(big.body.data).toMatchObject({ width: 2000, height: 1000 });
    expect((await send(webp, "tiny.webp", "image/webp")).status).toBe(201);
  });
});

describe("rejected uploads", () => {
  it("rejects SVG, even when it claims to be an image", async () => {
    const { send } = await setup();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>');
    const res = await send(svg, "logo.svg", "image/svg+xml");
    expect(res.status).toBe(415);
    expect((await send(svg, "logo.png", "image/png")).status).toBe(415);
  });

  it("rejects an HTML file renamed to .jpg", async () => {
    const { send } = await setup();
    const html = new TextEncoder().encode("<!doctype html><script>document.cookie</script>");
    const res = await send(html, "photo.jpg", "image/jpeg");
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects a file with JPEG magic bytes but no image inside", async () => {
    const { send } = await setup();
    const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("not really a jpeg at all")]);
    expect((await send(fake, "fake.jpg", "image/jpeg")).status).toBe(415);
  });

  it("rejects files over 5 MB", async () => {
    const { send } = await setup();
    const huge = new Uint8Array(5 * 1024 * 1024 + 1);
    huge.set([0xff, 0xd8, 0xff]);
    const res = await send(huge, "huge.jpg", "image/jpeg");
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects a request without a file, and JSON instead of multipart", async () => {
    const { p, listingId } = await setup();
    expect((await upload(imagesRoute.POST, `/api/v1/listings/${listingId}/images`, { id: listingId }, null, p.cookie)).status).toBe(400);
    const json = await call(imagesRoute.POST, "POST", `/api/v1/listings/${listingId}/images`, { cookie: p.cookie, params: { id: listingId }, body: { url: "http://x" } });
    expect(json.status).toBe(415);
  });

  it("stops at 10 images per listing", async () => {
    const { send } = await setup();
    const img = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).jpeg().toBuffer();
    for (let i = 0; i < 10; i++) expect((await send(img, `${i}.jpg`, "image/jpeg")).status).toBe(201);
    const eleventh = await send(img, "11.jpg", "image/jpeg");
    expect(eleventh.status).toBe(409);
    expect(eleventh.body.error.code).toBe("IMAGE_LIMIT");
    expect(await ownerQuery("select count(*)::int as n from bookwise.listing_images")).toEqual([{ n: 10 }]);
  });

  it("requires a session", async () => {
    const { listingId } = await setup();
    const img = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).jpeg().toBuffer();
    expect((await upload(imagesRoute.POST, `/api/v1/listings/${listingId}/images`, { id: listingId }, { bytes: img, name: "a.jpg", type: "image/jpeg" })).status).toBe(401);
  });
});

describe("serving and deleting", () => {
  it("refuses media paths that are not a generated key (no traversal)", async () => {
    const { p } = await setup();
    for (const file of ["../../etc/passwd", "x.webp", "..%2F..%2Fsecret.webp", "00000000-0000-4000-8000-000000000000.png"]) {
      const res = await mediaRoute.GET(new Request(`${APP}/api/v1/media/${p.orgId}/${file}`), { params: Promise.resolve({ orgId: p.orgId, file }) });
      expect(res.status, file).toBe(400);
    }
  });

  it("deletes the file along with the row", async () => {
    const { p, listingId, send } = await setup();
    const img = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).jpeg().toBuffer();
    const res = await send(img, "a.jpg", "image/jpeg");
    const imageId = res.body.data.id as string;
    const del = await call(imageRoute.DELETE, "DELETE", `/api/v1/listings/${listingId}/images/${imageId}`, { cookie: p.cookie, params: { id: listingId, imageId } });
    expect(del.status).toBe(204);
    expect((await media(res.body.data.url)).status).toBe(404);
    expect(readdirSync(`${process.env.UPLOADS_DIR}/org/${p.orgId}`)).toEqual([]);
  });
});
