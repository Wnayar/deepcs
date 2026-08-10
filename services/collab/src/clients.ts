import { z } from 'zod';
import { USER_ID_HEADER } from '@deepcs/shared/headers';

const participantResponse = z.object({
  participant: z.boolean(),
  questionId: z.string().optional(),
  partnerUid: z.string().optional(),
});

/**
 * How long to wait on a sibling service before giving up. Without a bound, a
 * hung Questions leaves a room build pending forever — the socket never gets
 * a room, and `snapshotAllRooms` awaits that same promise on SIGTERM, so the
 * shutdown snapshot never runs and Cloud Run SIGKILLs at the grace deadline.
 */
const REQUEST_TIMEOUT_MS = 5_000;

export interface SessionAuthorization {
  questionId: string;
  partnerUid: string | null;
}

/**
 * Asks Matching whether `uid` is one of the two people in `sessionId` — e.g.
 *   checkSessionParticipant(matchingUrl, 's42', 'bob')
 * returns `{ questionId, partnerUid }` if bob is a participant, or `null` if
 * the session doesn't exist or bob isn't in it. The Gateway can't answer this
 * itself (it holds no session data), so a WebSocket handshake to `/collab`
 * calls this before the socket is allowed to upgrade.
 */
export async function checkSessionParticipant(
  matchingUrl: string,
  sessionId: string,
  uid: string,
): Promise<SessionAuthorization | null> {
  const url = new URL(`/match/sessions/${encodeURIComponent(sessionId)}/participant`, matchingUrl);

  // The uid travels as X-User-Id, not a query param: Matching only ever
  // answers about the caller, so this header *is* the question. Setting it
  // directly is the same trust model every internal call in this system uses
  // — the Gateway is what verified it, and it strips any inbound copy.
  const res = await fetch(url, {
    headers: { [USER_ID_HEADER]: uid },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`matching service returned ${res.status}`);
  }

  // Only `participant` and `questionId` gate the answer. `partnerUid` is
  // parsed to pin Matching's response shape (that is what the contract test
  // asserts) but is deliberately not required here: making it a condition
  // would turn a future response-shape change into a 403 for someone who
  // really is in the session, which is the wrong way to fail.
  const body = participantResponse.parse(await res.json());
  if (!body.participant || !body.questionId) return null;
  return { questionId: body.questionId, partnerUid: body.partnerUid ?? null };
}

const questionResponse = z.object({
  id: z.string(),
  title: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  parts: z.array(z.string()),
  tags: z.array(z.string()),
  createdAt: z.string(),
});

export type Question = z.infer<typeof questionResponse>;

/**
 * Fetches a question's parts — e.g. getQuestion(questionsUrl, 'q1') — used to
 * seed a freshly created Yjs doc (see rooms.ts). Returns `null` if the id
 * doesn't exist, which shouldn't happen in practice since Matching already
 * validated the id when the session was created.
 */
export async function getQuestion(
  questionsUrl: string,
  questionId: string,
): Promise<Question | null> {
  const res = await fetch(`${questionsUrl}/questions/${encodeURIComponent(questionId)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`questions service returned ${res.status}`);
  }
  return questionResponse.parse(await res.json());
}
