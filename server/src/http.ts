/** An error whose message is safe to show the user, with an HTTP status (the error handler uses statusCode). */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message);

/** Validates a list of numeric ids from a request body. */
export function idList(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((v) => Number.isInteger(v))) throw badRequest('trackIds must be a list of track ids');
  return value as number[];
}
