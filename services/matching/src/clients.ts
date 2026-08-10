import { z } from 'zod';

const existsResponse = z.object({ exists: z.boolean() });

/**
 * Asks Users whether a uid has a profile row — e.g.
 * `checkUserExists('http://users:8081', 'abc123')` resolves to `true` or
 * `false`. Throws on a network error, a non-2xx response, or a response that
 * doesn't match the expected shape, so a Users outage or an API change shows
 * up as a clear error instead of silently treating a real user as missing.
 */
export async function checkUserExists(usersUrl: string, uid: string): Promise<boolean> {
  const res = await fetch(`${usersUrl}/users/${encodeURIComponent(uid)}/exists`);
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

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`questions service returned ${res.status}`);
  }
  const body = listResponse.parse(await res.json());
  return body.items[0]?.id ?? null;
}
