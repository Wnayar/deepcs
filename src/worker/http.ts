/** A response the router can throw from anywhere: 401 means "who are you",
 * 402 means "pay first". */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps any value as a JSON response. Every route answers through here, so
 * the content-type is set in exactly one place. */
export function json(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);

  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
