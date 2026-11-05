/**
 * Every error the API returns has a stable machine-readable `code`. Clients branch on the
 * code, never on the message, so messages can be improved without breaking anyone.
 */
export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  INVALID_JSON: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CROSS_ORIGIN_BLOCKED: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "AppError";
    this.status = ERROR_STATUS[code];
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
