import { idToken } from './auth';
import { GATEWAY_URL } from './config';
import type { Session } from './api';

/** How long to wait before reopening a stream that dropped. Short, because a
 * drop usually means a network blip or a proxy recycling an idle connection,
 * and the whole point of this is not to be late. */
const REOPEN_MS = 2_000;

/**
 * Reads one server-sent-events stream and yields the payload of each `data:`
 * frame.
 *
 * The format is plain text: `data: <payload>` and a blank line ends the frame.
 * Lines beginning with `:` are comments, which the server sends as heartbeats
 * so an idle connection is not mistaken for a dead one, and are skipped here.
 *
 * The buffer matters. A chunk from the network is not a frame: one read can
 * deliver half an event or three of them, so frames are cut on the blank line
 * rather than assumed to arrive one per chunk.
 */
async function* frames(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;

    buffered += decoder.decode(value, { stream: true });

    let split = buffered.indexOf('\n\n');
    while (split !== -1) {
      const frame = buffered.slice(0, split);
      buffered = buffered.slice(split + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (data) yield data;
      split = buffered.indexOf('\n\n');
    }
  }
}

/**
 * Watches for a partner and calls back once, with the session.
 *
 * This replaced polling. Being matched is caused by somebody else's request, so
 * a client that wants to know either asks repeatedly or is told, and asking
 * repeatedly cost two things: it kept the database awake and every service warm
 * for people who were only waiting, and slowing it down enough to be affordable
 * meant hearing about a partner up to twenty seconds after they arrived.
 *
 * `fetch` rather than `EventSource`, which is the built-in API for this. It
 * cannot set request headers, so it cannot send `Authorization`, and the token
 * would have to travel in the query string. Reading the stream by hand costs
 * this file's frame parsing and keeps authentication identical to every other
 * request the app makes.
 *
 * Returns a function that stops watching.
 */
export function watchForMatch(
  onMatched: (session: Session) => void,
  /** How to get the caller's token. Overridable so the test can drive a real
   * stream without signing the Firebase SDK in. */
  token: () => Promise<string | null> | string | null = idToken,
): () => void {
  let stopped = false;
  let controller: AbortController | null = null;

  const run = async () => {
    while (!stopped) {
      try {
        const bearer = await token();
        // Signed out there is nobody to tell, and an unauthenticated stream is
        // refused anyway. Stop rather than reconnect against a 401 forever.
        if (!bearer) return;

        controller = new AbortController();
        const response = await fetch(`${GATEWAY_URL}/match/events`, {
          headers: { authorization: `Bearer ${bearer}` },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`stream refused: ${response.status}`);

        for await (const data of frames(response.body)) {
          const event = JSON.parse(data) as { type?: string } & Session;
          if (event.type === 'matched') {
            if (!stopped) onMatched(event);
            return;
          }
        }
      } catch {
        // A drop is ordinary: proxies close idle connections and networks come
        // and go. Reopening is the recovery, and the server resends the current
        // session on connect, so nothing that happened during the gap is lost.
      }

      if (stopped) return;
      await new Promise((resolve) => setTimeout(resolve, REOPEN_MS));
    }
  };

  void run();

  return () => {
    stopped = true;
    controller?.abort();
  };
}
