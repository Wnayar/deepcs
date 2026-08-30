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

/** The Authorization header, or an empty set when signed out. */
async function authHeaders(): Promise<Headers> {
  const headers = new Headers();

  // Absent when signed out; the free tier needs no identity.
  const token = await idToken();

  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  return headers;
}

/** One JSON call to the Worker: signs it, and turns a failure into ApiError
 * so callers can branch on the status rather than parse a message. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  for (const [name, value] of await authHeaders()) {
    headers.set(name, value);
  }

  if (init.body) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(path, { ...init, headers });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    const message = body?.error ?? `request failed with ${response.status}`;

    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
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

/** Fetches the map file and flattens its nested grid into flat coordinates. */
async function fetchRoadmap(): Promise<RoadmapTopic[]> {
  const response = await fetch('/content/roadmap.json');

  if (!response.ok) {
    throw new ApiError(response.status, 'roadmap fetch failed');
  }

  const file = (await response.json()) as RoadmapFile;

  return file.topics.map((topic) => ({
    topic: topic.id,
    title: topic.title,
    summary: topic.summary,
    dependsOn: topic.dependsOn,
    gridX: topic.grid.x,
    gridY: topic.grid.y,
    tier: topic.tier,
    access: topic.access,
    steps: topic.steps,
  }));
}

/** Every topic on the map, loaded once per page load. */
export function getRoadmap(): Promise<RoadmapTopic[]> {
  if (roadmapOnce !== null) {
    return roadmapOnce;
  }

  roadmapOnce = fetchRoadmap().catch((err: unknown) => {
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

/** Fetches one tier's question bank and indexes it by step id. */
async function fetchQuestions(access: Access): Promise<Map<string, StepQuestions>> {
  let path = '/content/questions.json';

  if (access === 'paid') {
    path = '/content/paid/questions.json';
  }

  const response = await fetch(path, { headers: await authHeaders() });

  if (!response.ok) {
    throw new ApiError(response.status, 'questions fetch failed');
  }

  const file = (await response.json()) as QuestionsFile;
  const byStep = new Map<string, StepQuestions>();

  for (const step of file.steps) {
    byStep.set(step.id, step);
  }

  return byStep;
}

/** One tier's question bank, loaded once per page load. Cached per tier,
 * because the paid one can fail with 401/402 while the free one succeeds. */
function getQuestions(access: Access): Promise<Map<string, StepQuestions>> {
  const cached = questionsOnce.get(access);

  if (cached !== undefined) {
    return cached;
  }

  const once = fetchQuestions(access).catch((err: unknown) => {
    // Do not cache a rejection; signing in must be able to retry.
    questionsOnce.delete(access);
    throw err;
  });

  questionsOnce.set(access, once);

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

/** Everything the step page shows: the map entry, the lesson body, and the
 * questions, gathered from three files. */
export async function getStep(id: string): Promise<StepDetail> {
  const topics = await getRoadmap();

  for (const topic of topics) {
    const step = topic.steps.find((candidate) => candidate.id === id);

    if (!step) {
      continue;
    }

    let lessonPath = `/content/lessons/${id}.md`;

    if (topic.access === 'paid') {
      lessonPath = `/content/paid/lessons/${id}.md`;
    }

    const response = await fetch(lessonPath, { headers: await authHeaders() });

    if (!response.ok) {
      throw new ApiError(response.status, 'lesson fetch failed');
    }

    const lessonMd = await response.text();
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
