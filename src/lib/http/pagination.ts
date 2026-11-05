import { z } from "zod";

import type { PageMeta } from "./response";

/** Query parameters shared by every list endpoint. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof PageQuery>;

export function pageOffset({ page, pageSize }: PageQuery): number {
  return (page - 1) * pageSize;
}

export function pageMeta({ page, pageSize }: PageQuery, total: number): PageMeta {
  return { page, pageSize, total };
}
