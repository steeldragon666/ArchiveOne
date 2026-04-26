export class ApiError extends Error {
  constructor(
    public status: number,
    public errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UnauthenticatedError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(401, errorCode, message);
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(403, errorCode, message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(404, errorCode, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(409, errorCode, message);
    this.name = 'ConflictError';
  }
}

interface ApiErrorBody {
  error: string;
  message: string;
  requestId?: string;
}

/**
 * Typed fetch wrapper for the Fastify API.
 *
 * - Always sends credentials so the cpa_session cookie travels along.
 * - On non-2xx, parses the error envelope and throws a typed error.
 * - On 401, the caller (typically a query hook or AuthGuard) decides
 *   whether to redirect to /login.
 * - On 204, returns undefined (no body to parse).
 *
 * Error class hierarchy lets call sites distinguish:
 *   try { ... } catch (err) {
 *     if (err instanceof UnauthenticatedError) router.push('/login');
 *     else if (err instanceof ConflictError) toast(err.message);
 *     else throw err;
 *   }
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let body: ApiErrorBody = { error: 'unknown', message: `HTTP ${res.status}` };
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // non-JSON error body; keep defaults
  }

  switch (res.status) {
    case 401:
      throw new UnauthenticatedError(body.error, body.message);
    case 403:
      throw new ForbiddenError(body.error, body.message);
    case 404:
      throw new NotFoundError(body.error, body.message);
    case 409:
      throw new ConflictError(body.error, body.message);
    default:
      throw new ApiError(res.status, body.error, body.message);
  }
}
