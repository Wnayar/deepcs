import { idToken } from './auth';
import { GATEWAY_URL } from './config';

/**
 * The typed client for everything behind the Gateway.
 *
 * One rule holds throughout: the browser never talks to a service directly.
 * Ports 8081–8084 are not part of the contract — the Gateway is the single
 * public origin, it is where authentication happens, and it is the only thing
 * with CORS configured for this app.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Question {
  id: string;
  title: string;
  difficulty: Difficulty;
  parts: string[];
  tags: string[];
  createdAt: string;
}

export interface Session {
  id: string;
  questionId: string;
  createdAt: string;
}

export type MatchStatus =
  { status: 'waiting' } | { status: 'none' } | { status: 'matched'; session: Session };

export interface RevealState {
  /** Whether *you* have agreed, and whether your partner has. Two booleans
   * rather than the uids that consented: a session never names the other
   * person, and "have I agreed?" is not answerable from a list of ids without
   * the browser knowing its own uid to search for. */
  you: boolean;
  partner: boolean;
  revealed: boolean;
  referenceMd?: string;
}

/** A failed request, carrying the status so a caller can tell "not signed in"
 * from "not allowed" from "the service is down". */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await idToken();
  const headers = new Headers(init.headers);
  // Absent when signed out, and that is a valid state rather than an error —
  // the question bank is public. The Gateway reads a missing token as
  // anonymous and falls back to per-IP rate limiting.
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');

  const res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    // Every service in this system answers errors as `{ error: "..." }`, but
    // a proxy or a crash can still produce HTML, so parsing is best-effort.
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `request failed with ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Creates this user's profile row if it does not exist, and returns it.
 *
 * Must be called once after signing in, before anything else: Users creates
 * the row lazily on this call, and `POST /match/join` rejects a uid Users has
 * never seen with "user not found". Signing in with Firebase alone is not
 * enough to exist inside this system.
 */
export function ensureProfile() {
  return request<{ id: string; firebaseUid: string }>('/users/me');
}

export function getQuestion(id: string) {
  return request<Question>(`/questions/${id}`);
}

/** The answer, for solo study. Needs a signed-in caller; the bank itself is
 * public but the answer key is not. */
export function questionReference(id: string) {
  return request<{ referenceMd: string }>(`/questions/${id}/reference`);
}

/** The session I am in right now, or null. Called on sign-in so the app knows
 * whether "find a partner" would actually start something new. */
export function currentSession() {
  return request<{ session: Session | null } | { status: 'matched'; session: Session }>(
    '/match/session',
  ).then((body) => body.session ?? null);
}

export function joinQueue(topic: string, difficulty: Difficulty) {
  return request<MatchStatus>('/match/join', {
    method: 'POST',
    body: JSON.stringify({ topic, difficulty }),
  });
}

export function matchStatus(topic: string, difficulty: Difficulty) {
  return request<MatchStatus>(
    `/match/status?topic=${encodeURIComponent(topic)}&difficulty=${difficulty}`,
  );
}

/** Agree to reveal. Returns the answer only once the partner has agreed too. */
export function consentToReveal(sessionId: string) {
  return request<RevealState>(`/match/sessions/${sessionId}/reveal`, { method: 'POST' });
}

/** Read consent state without granting it — what the session page checks while
 * waiting on the other person. */
export function revealState(sessionId: string) {
  return request<RevealState>(`/match/sessions/${sessionId}/reveal`);
}

export function endSession(sessionId: string) {
  return request<{ endedAt: string }>(`/match/sessions/${sessionId}/end`, { method: 'POST' });
}

export interface RoadmapStep {
  id: string;
  step: number;
  title: string;
  questionCount: number;
}

export interface RoadmapTopic {
  topic: string;
  title: string;
  summary: string;
  /** Topics that make this one easier to read, drawn as an arrow into it. */
  dependsOn: string[];
  gridX: number;
  gridY: number;
  steps: RoadmapStep[];
}

export interface Step {
  id: string;
  topic: string;
  topicTitle: string;
  step: number;
  title: string;
  difficulty: Difficulty;
  parts: string[];
  lessonMd: string;
  siblings: { id: string; step: number; title: string }[];
}

/** The nine topics with their prerequisites and steps. Public: the roadmap
 * works signed out. */
export function getRoadmap() {
  return request<{ topics: RoadmapTopic[] }>('/roadmap');
}

/** One step in full: its lesson, its questions, and its sibling steps. */
export function getStep(id: string) {
  return request<Step>(`/steps/${id}`);
}
