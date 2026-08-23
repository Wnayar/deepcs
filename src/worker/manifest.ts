import type { Env } from './env';

/**
 * The step manifest, read from the deployed roadmap.json through the assets
 * binding and cached at module scope. It answers two questions the API must
 * not take a caller's word for: does this step exist (an unknown id is a
 * 400 before any SQL — the write-quota guard, DESIGN.md §12), and which
 * tier does it belong to. A deploy replaces isolates, so the cache can
 * never outlive the content it describes.
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
      // A failed read must not poison every later request in this isolate.
      manifest = null;
      throw err;
    });
  return manifest;
}
