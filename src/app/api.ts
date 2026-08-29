import { idToken } from './auth';

/**
 * Data access. Content is static files served from the edge; only `/api/*`
 * and paid content reach the Worker. Gated fetches carry the Firebase ID
 * token and answer 401 (sign in), 402 (pay first), or the bytes.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';
/** A topic's band on the map: the difficulty ladder, or the Skills track
 * (craft and career topics with no prerequisites). */
export type Tier = 'easy' | 'medium' | 'hard' | 'skills';
export type Access = 'free' | 'paid';

/** A failed request, carrying the status so callers can tell 401 from 402
 * from an outage. */
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
  // Absent when signed out; the free tier needs no identity.
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
  tier: Tier;
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
    tier: Tier;
    access: Access;
    steps: RoadmapStep[];
  }[];
}

/** One in-flight promise serves every caller, so navigation never refetches
 * the map within a page.
 *
 * GET /content/roadmap.json -> {topics: [...]}, a static file the Worker
 * never sees, so locked topics are public and there is nothing to sign. */
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
        tier: t.tier,
        access: t.access,
        steps: t.steps,
      })),
    )
    .catch((err: unknown) => {
      // Do not cache a rejection; the next call retries.
      roadmapOnce = null;
      throw err;
    });
  return roadmapOnce;
}

export interface StepQuestions {
  id: string;
  parts: string[];
  referenceMd: string;
}

interface QuestionsFile {
  steps: { id: string; parts: string[]; referenceMd: string }[];
}

/** GET /content/questions.json, or /content/paid/questions.json -> {steps: [...]}
 * The paid path runs the Worker, so it answers 401 or 402 to a caller who
 * may not have it. */
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

/** One step in full. Throws ApiError 401/402 on a paid step the caller may
 * not see; the step page turns those into sign-in and upgrade prompts. */
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

export interface Progress {
  stepId: string;
  done: boolean;
  starred: boolean;
}

/** The reader's marks and entitlement, in one call. */
export function getMe() {
  return request<{ progress: Progress[]; entitled: boolean }>('/api/me');
}

/** Replaces both flags for one step, so the same call twice lands on the
 * same row and optimistic retries are safe. */
export function setProgress(stepId: string, done: boolean, starred: boolean) {
  return request<Progress>(`/api/me/progress/${stepId}`, {
    method: 'PUT',
    body: JSON.stringify({ done, starred }),
  });
}

/** What /upgrade/thanks polls while the purchase webhook races the redirect. */
export function getEntitlement() {
  return request<{ entitled: boolean }>('/api/me/entitlement');
}

/** Starts a checkout; the Worker binds it to the verified uid and returns
 * the hosted checkout URL. */
export function startCheckout() {
  return request<{ url: string }>('/api/checkout', { method: 'POST' });
}
