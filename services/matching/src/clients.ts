import { z } from 'zod';

/**
 * How long to wait on a sibling service before giving up. Unbounded `fetch`
 * would let a hung Users or Questions hold this request — and its Cloud Run
 * concurrency slot — open indefinitely.
 */
const REQUEST_TIMEOUT_MS = 5_000;

const existsResponse = z.object({ exists: z.boolean() });

/**
 * Asks Users whether a uid has a profile row — e.g.
 * `checkUserExists('http://users:8081', 'abc123')` resolves to `true` or
 * `false`. Throws on a network error, a non-2xx response, or a response that
 * doesn't match the expected shape, so a Users outage or an API change shows
 * up as a clear error instead of silently treating a real user as missing.
 */
export async function checkUserExists(usersUrl: string, uid: string): Promise<boolean> {
  const res = await fetch(`${usersUrl}/users/${encodeURIComponent(uid)}/exists`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`users service returned ${res.status}`);
  }
  return existsResponse.parse(await res.json()).exists;
}

const questionSummary = z.object({
  id: z.string(),
  title: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  parts: z.array(z.string()),
  tags: z.array(z.string()),
  createdAt: z.string(),
});
const listResponse = z.object({
  items: z.array(questionSummary),
  nextCursor: z.string().nullable(),
});

/**
 * Finds one question matching a topic (a Questions tag, e.g. "os") and a
 * difficulty — e.g. `findQuestion('http://questions:8082', 'os', 'hard')`
 * returns a question id, or `null` if nothing matches. Same failure
 * behaviour as `checkUserExists`: a bad response throws rather than quietly
 * returning `null`, so a Questions outage is distinguishable from "no
 * matching question."
 */
export async function findQuestion(
  questionsUrl: string,
  topic: string,
  difficulty: 'easy' | 'medium' | 'hard',
): Promise<string | null> {
  const url = new URL('/questions', questionsUrl);
  url.searchParams.set('tags', topic);
  url.searchParams.set('difficulty', difficulty);
  url.searchParams.set('limit', '1');

  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`questions service returned ${res.status}`);
  }
  const body = listResponse.parse(await res.json());
  return body.items[0]?.id ?? null;
}

const referenceResponse = z.object({ referenceMd: z.string() });

/**
 * Fetches a question's answer text — e.g.
 * `fetchReferenceMd('http://questions:8082', '3f2e...')` returns the markdown,
 * or `null` if the question is gone.
 *
 * Called only after this service has confirmed both participants consented
 * (ADR-06). The path is `/internal/...` rather than `/questions/...` because
 * the Gateway proxies the `/questions` prefix wholesale — an answer route
 * under it would be public. Nothing proxies `/internal`, so this call only
 * works from inside the network.
 */
export async function fetchReferenceMd(
  questionsUrl: string,
  questionId: string,
): Promise<string | null> {
  const res = await fetch(
    `${questionsUrl}/internal/questions/${encodeURIComponent(questionId)}/reference`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`questions service returned ${res.status}`);
  }
  return referenceResponse.parse(await res.json()).referenceMd;
}
