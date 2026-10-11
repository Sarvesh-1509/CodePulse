/** HTTP error with an explicit status code for the centralized error handler. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function unauthorized(message = "Authentication required"): HttpError {
  return new HttpError(401, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}
