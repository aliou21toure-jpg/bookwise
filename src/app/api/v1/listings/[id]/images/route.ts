import { AppError } from "@/lib/http/errors";
import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { IdParams, MAX_UPLOAD_BYTES, addImage } from "@/modules/listings";

/**
 * POST /api/v1/listings/:id/images — multipart/form-data with `file` and optional `altText`.
 * The file is checked by its bytes (JPEG, PNG or WebP only), limited to 5 MB, and
 * re-encoded to WebP before it is stored.
 */
export const POST = defineRoute({ params: IdParams }, async ({ request, requestId, params }) => {
  const ctx = await requireUser(request);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError("PAYLOAD_TOO_LARGE", "Images can be at most 5 MB.");
  if (!(request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Send the image as multipart/form-data.");
  }
  const form = await request.formData().catch(() => {
    throw new AppError("BAD_REQUEST", "Could not read the upload.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "Attach an image in the `file` field.");
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Images can be at most 5 MB.");
  const altText = String(form.get("altText") ?? "").trim().slice(0, 200);
  const image = await addImage(ctx, params.id, new Uint8Array(await file.arrayBuffer()), altText, requestMeta(request, requestId));
  return { data: image, status: 201 };
});
