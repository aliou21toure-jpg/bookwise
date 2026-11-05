import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { ImageParams, removeImage } from "@/modules/listings";

/** DELETE /api/v1/listings/:id/images/:imageId */
export const DELETE = defineRoute({ params: ImageParams }, async ({ request, params }) => {
  const ctx = await requireUser(request);
  await removeImage(ctx, params.id, params.imageId);
  return { data: null, status: 204 };
});
