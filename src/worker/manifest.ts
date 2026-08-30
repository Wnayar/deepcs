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

type AccessByStep = Map<string, 'free' | 'paid'>;

let cached: Promise<AccessByStep> | null = null;

/** Fetches roadmap.json once and flattens its topics into a step id lookup. */
async function loadStepAccess(request: Request, env: Env): Promise<AccessByStep> {
  const url = new URL('/content/roadmap.json', request.url);
  const response = await env.ASSETS.fetch(url);

  if (!response.ok) {
    throw new Error(`roadmap.json unreadable: ${response.status}`);
  }

  const file = (await response.json()) as RoadmapFile;
  const byStep: AccessByStep = new Map();

  for (const topic of file.topics) {
    for (const step of topic.steps) {
      byStep.set(step.id, topic.access);
    }
  }

  return byStep;
}

/** The step id lookup, loaded on first use and reused for the isolate's life. */
export function stepAccess(request: Request, env: Env): Promise<AccessByStep> {
  if (cached !== null) {
    return cached;
  }

  cached = loadStepAccess(request, env).catch((err: unknown) => {
    // Do not cache a rejection; the next request retries.
    cached = null;
    throw err;
  });

  return cached;
}
