import { idToken } from './auth';

/**
 * The typed client for everything the page fetches.
 *
 * Two kinds of fetch live here and the split is the architecture (DESIGN.md
 * §3): content is static files served from the edge, and only `/api/*` plus
 * paid content ever reaches the Worker. Free reads carry no token and cost
 * nothing; gated reads carry the Firebase ID token and answer 401 (who are
 * you), 402 (pay first), or the bytes.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Access = 'free' | 'paid';

/** A failed request, carrying the status so a caller can tell "not signed
 * in" (401) from "not entitled" (402) from "the service is down". */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function authHeaders(): Promise<Headers> {
  const headers = new Headers();
  // Absent when signed out, and that is a valid state rather than an error —
  // the free tier needs no identity at all.
  const token = await idToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [k, v] of await authHeaders()) headers.set(k, v);
  if (init.body) headers.set('content-type', 'application/json');

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `request failed with ${res.status}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Content: static files. The shapes here mirror content/roadmap.json and
// content/questions.json, then get adapted to what the pages render.

export interface RoadmapStep {
  id: string;
  step: number;
  title: string;
  difficulty: Difficulty;
}

export interface RoadmapTopic {
  topic: string;
  title: string;
  summary: string;
  /** Topics that make this one easier to read, drawn as an arrow into it. */
  dependsOn: string[];
  gridX: number;
  gridY: number;
  access: Access;
  steps: RoadmapStep[];
}

interface RoadmapFile {
  topics: {
    id: string;
    title: string;
    summary: string;
    dependsOn: string[];
    grid: { x: number; y: number };
    access: Access;
    steps: RoadmapStep[];
  }[];
}

/** The roadmap file is one fetch for the whole map, so one in-flight promise
 * serves every caller and navigation never refetches it. The browser cache
 * holds it across visits regardless; this only dedupes within one page. */
let roadmapOnce: Promise<RoadmapTopic[]> | null = null;

export function getRoadmap(): Promise<RoadmapTopic[]> {
  roadmapOnce ??= fetch('/content/roadmap.json')
    .then((res) => {
      if (!res.ok) throw new ApiError(res.status, 'roadmap fetch failed');
      return res.json() as Promise<RoadmapFile>;
    })
    .then((file) =>
      file.topics.map((t) => ({
        topic: t.id,
        title: t.title,
        summary: t.summary,
        dependsOn: t.dependsOn,
        gridX: t.grid.x,
        gridY: t.grid.y,
        access: t.access,
        steps: t.steps,
      })),
    )
    .catch((err: unknown) => {
      // A failed fetch must not poison every later caller with a rejected
      // cached promise; the next call retries.
      roadmapOnce = null;
      throw err;
    });
  return roadmapOnce;
}

export interface StepQuestions {
  id: string;
  parts: string[];
  /** The whole answer key for this step. Self-serve: on the free tier it is
   * public, on the paid tier the file only arrives entitled. */
  referenceMd: string;
}

interface QuestionsFile {
  steps: { id: string; parts: string[]; referenceMd: string }[];
}

const questionsOnce = new Map<Access, Promise<Map<string, StepQuestions>>>();

function getQuestions(access: Access): Promise<Map<string, StepQuestions>> {
  let once = questionsOnce.get(access);
  if (!once) {
    const path = access === 'paid' ? '/content/paid/questions.json' : '/content/questions.json';
    once = (async () => {
      const res = await fetch(path, { headers: await authHeaders() });
      if (!res.ok) throw new ApiError(res.status, 'questions fetch failed');
      const file = (await res.json()) as QuestionsFile;
      return new Map(file.steps.map((s) => [s.id, s]));
    })().catch((err: unknown) => {
      questionsOnce.delete(access);
      throw err;
    });
    questionsOnce.set(access, once);
  }
  return once;
}

/** One step in full: everything the step page renders. Throws ApiError 402
 * on a paid step for an unentitled caller, 401 for an anonymous one — the
 * page turns those into the upgrade and sign-in prompts. */
export interface StepDetail {
  id: string;
  topic: string;
  topicTitle: string;
  access: Access;
  step: number;
  title: string;
  difficulty: Difficulty;
  parts: string[];
  referenceMd: string;
  lessonMd: string;
}

export async function getStep(id: string): Promise<StepDetail> {
  const topics = await getRoadmap();
  for (const topic of topics) {
    const step = topic.steps.find((s) => s.id === id);
    if (!step) continue;

    const lessonPath =
      topic.access === 'paid' ? `/content/paid/lessons/${id}.md` : `/content/lessons/${id}.md`;
    const res = await fetch(lessonPath, { headers: await authHeaders() });
    if (!res.ok) throw new ApiError(res.status, 'lesson fetch failed');
    const lessonMd = await res.text();

    const questions = (await getQuestions(topic.access)).get(id);
    return {
      id,
      topic: topic.topic,
      topicTitle: topic.title,
      access: topic.access,
      step: step.step,
      title: step.title,
      difficulty: step.difficulty,
      parts: questions?.parts ?? [],
      referenceMd: questions?.referenceMd ?? '',
      lessonMd,
    };
  }
  throw new ApiError(404, 'no such step');
}

// ---------------------------------------------------------------------------
// The API: progress and entitlement, keyed to the verified caller. No route
// takes a uid; `/me` is whoever the token says (DESIGN.md §12).

export interface Progress {
  stepId: string;
  done: boolean;
  starred: boolean;
}

/** Everything the signed-in shell needs, in one call: the reader's marks and
 * whether they own the paid tier. */
export function getMe() {
  return request<{ progress: Progress[]; entitled: boolean }>('/api/me');
}

/** Set both flags for one step. Sent on every click without waiting for the
 * answer, which is safe because the route replaces state rather than
 * toggling it — the same call twice lands on the same row. */
export function setProgress(stepId: string, done: boolean, starred: boolean) {
  return request<Progress>(`/api/me/progress/${stepId}`, {
    method: 'PUT',
    body: JSON.stringify({ done, starred }),
  });
}

/** Just the entitlement flag: what /upgrade/thanks polls (bounded) while the
 * purchase webhook races the redirect back. */
export function getEntitlement() {
  return request<{ entitled: boolean }>('/api/me/entitlement');
}

/** Start a checkout. The Worker binds the session to the verified uid and
 * hands back Stripe's hosted checkout URL. */
export function startCheckout() {
  return request<{ url: string }>('/api/checkout', { method: 'POST' });
}
