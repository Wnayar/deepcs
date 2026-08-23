import type { Env } from './env';

/**
 * Step id -> access tier, read from the deployed roadmap.json and cached at
 * module scope (a deploy replaces isolates, so the cache cannot outlive its
 * content). Unknown step ids are rejected before any SQL, which is what
 * keeps one user from writing unbounded rows.
 */

interface RoadmapFile {
  topics: { access: 'free' | 'paid'; steps: { id: string }[] }[];
}

let manifest: Promise<Map<string, 'free' | 'paid'>> | null = null;

export function stepAccess(request: Request, env: Env): Promise<Map<string, 'free' | 'paid'>> {
  manifest ??= env.ASSETS.fetch(new URL('/content/roadmap.json', request.url))
    .then((res) => {
      if (!res.ok) throw new Error(`roadmap.json unreadable: ${res.status}`);
      return res.json() as Promise<RoadmapFile>;
    })
    .then(
      (file) =>
        new Map(
          file.topics.flatMap((topic) => topic.steps.map((step) => [step.id, topic.access])),
        ),
    )
    .catch((err: unknown) => {
      // Do not cache a rejection; the next request retries.
      manifest = null;
      throw err;
    });
  return manifest;
}
