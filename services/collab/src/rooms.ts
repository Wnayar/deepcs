import { randomUUID } from 'node:crypto';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import * as Y from 'yjs';
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type WebSocket from 'ws';
import { getQuestion } from './clients.js';
import { loadSnapshot, saveSnapshot } from './repository.js';

/**
 * The outer envelope multiplexing sync and awareness messages over one
 * socket — the same convention y-websocket uses, so a reader who already
 * knows the Yjs ecosystem recognizes it rather than having to learn a new
 * one. (`y-protocols/sync`'s own message-type constants are a level below
 * this: they distinguish sync step 1/step 2/update *within* a sync message.)
 */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

const SNAPSHOT_INTERVAL_MS = 30_000;

/**
 * The clientID every seeded document is built under.
 *
 * Yjs identifies each character by the pair (clientID, clock). Two instances
 * seeding the same question under two random clientIDs would hold documents
 * that *read* identically and are structurally unrelated — so an edit made on
 * one references structs the other has never seen, Yjs parks it unapplied,
 * and the two sides silently stop converging while both look healthy. Seeding
 * through one fixed id makes the scaffold byte-identical on every instance,
 * so a second copy merges into the first instead of duplicating it.
 */
const SEED_CLIENT_ID = 0;

export interface Logger {
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export interface RoomDeps {
  pool: pg.Pool;
  redis: Redis;
  questionsUrl: string;
  log: Logger;
}

export interface Room {
  doc: Y.Doc;
  awareness: Awareness;
  sockets: Set<WebSocket>;
  /** Which awareness client ids came from which socket, so a disconnect can
   * clear only that socket's presence — see the note in `leaveRoom`. */
  socketAwarenessIds: Map<WebSocket, Set<number>>;
  subscriber: Redis;
  snapshotTimer: ReturnType<typeof setInterval>;
  /** Set once teardown starts. Destroying an Awareness emits one final
   * update, and a room that is already unsubscribed must not relay it. */
  closing: boolean;
}

function docChannel(sessionId: string): string {
  return `collab:doc:${sessionId}`;
}

function awarenessChannel(sessionId: string): string {
  return `collab:awareness:${sessionId}`;
}

function syncChannel(sessionId: string): string {
  return `collab:sync:${sessionId}`;
}

/** Matching's lifecycle channel. Named by Matching, not here — see
 * `sessionChannel` in services/matching/src/index.ts. */
function matchChannel(sessionId: string): string {
  return `match:session:${sessionId}`;
}

/**
 * The close code sent to a socket whose session was ended by its partner.
 *
 * In the 4000-4999 range, which the WebSocket spec leaves to applications. It
 * exists so the browser can tell "this is over" from "the connection dropped"
 * — the client reconnects on the second and must not on the first, and without
 * a distinct code both look identical. The frontend matches on the same number
 * in frontend/src/collab.ts.
 */
export const SESSION_ENDED_CODE = 4001;

/**
 * Builds the scaffold as a Yjs update: one heading per question part with the
 * part's own text under it, plus "## Our answer" and "## Scratch" (the overview:
 * the scaffold lets two people work in parallel without colliding, and
 * "## Scratch" doubles as the chat channel). It all lives in a single shared
 * `Y.Text` named "content" — phase 5 binds Monaco to that field via y-monaco.
 *
 * Returned as an update rather than written straight into the room's doc so
 * that it goes through SEED_CLIENT_ID and is identical on every instance.
 */
async function seedUpdate(questionsUrl: string, questionId: string): Promise<Uint8Array> {
  const question = await getQuestion(questionsUrl, questionId);
  if (!question) {
    // Matching validated this id when it created the session, so a 404 means
    // Questions lost the row afterwards. Failing the connection is the honest
    // outcome: seeding an empty document instead would look like it worked,
    // then get snapshotted 30s later, and the scaffold could never come back.
    throw new Error(`question ${questionId} not found`);
  }

  // A numbered list of the questions, and room under each to answer it.
  //
  // Not markdown headings, and no "Our answer" or "Scratch" sections. The
  // scaffold's whole job is to say which question you are on and give the two
  // of you somewhere to type; separate answer and scratch areas meant deciding
  // where a thought belonged before writing it down, and the numbering now
  // matches how the questions read everywhere else in the app.
  const lines: string[] = [];
  question.parts.forEach((part, i) => {
    lines.push(`${i + 1}. ${part}`, '', '', '');
  });

  const seed = new Y.Doc();
  seed.clientID = SEED_CLIENT_ID;
  seed.getText('content').insert(0, lines.join('\n'));
  return Y.encodeStateAsUpdate(seed);
}

async function snapshotDoc(pool: pg.Pool, sessionId: string, doc: Y.Doc): Promise<void> {
  await saveSnapshot(pool, sessionId, Buffer.from(Y.encodeStateAsUpdate(doc)));
}

/** Sends `payload` to every socket in the room except whoever caused it.
 * `sender` is a socket for a locally-originated change and the string
 * 'redis' for one that arrived from another instance, in which case no local
 * socket matches and everyone gets it. */
function broadcast(room: Room, payload: Uint8Array, sender: unknown): void {
  for (const socket of room.sockets) {
    if (socket === sender) continue;
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

export interface RoomManager {
  /**
   * Wires one already-authorized socket into its session's room and owns the
   * whole lifecycle: queue early frames, join, send the initial sync, replay
   * the queue, and leave on close. Resolves true if this socket is the one
   * that opened the room on this instance.
   */
  attachSocket(socket: WebSocket, sessionId: string, questionId: string): Promise<boolean>;

  /** Snapshots every room this manager currently holds — the SIGTERM leg of
   * The overview's "every 30s, on disconnect, and before SIGTERM". */
  snapshotAllRooms(): Promise<void>;

  /**
   * What this instance believes it is holding, for `/metrics`. Both numbers
   * are counted from the manager's own state rather than from the operating
   * system's open sockets, and that is the point: a leak is precisely the case
   * where the two disagree, because the connection is gone and the bookkeeping
   * still has it.
   */
  stats(): { sockets: number; rooms: number };
}

/**
 * One manager per Collab process, holding that process's in-memory rooms —
 * a factory rather than module-level state (same shape as `createQueue` in
 * matching/src/queue.ts) so a test can construct two independent managers
 * sharing one real Redis/Postgres, the way two real Collab instances would,
 * and prove the cross-instance relay actually crosses instances.
 */
export function createRoomManager(deps: RoomDeps): RoomManager {
  const rooms = new Map<string, Promise<Room>>();

  /**
   * Identifies this manager on the state-request channel so its rooms ignore
   * the echo of their own request — Redis delivers a published message to
   * every subscriber, the publisher included. Per manager rather than per
   * process because the manager is what owns the subscription; two managers
   * sharing one process (which is how the tests model two instances) have to
   * be able to answer each other.
   */
  const instanceId = randomUUID();

  /**
   * The rooms that finished building, which `rooms` cannot report on because
   * it holds promises and a metrics scrape has to answer without awaiting one.
   * Membership is added once a build resolves and removed in `teardown`, the
   * single place a room stops existing.
   */
  const live = new Set<Room>();

  /**
   * Returns the room for `sessionId`, building it (from a Postgres snapshot,
   * or freshly seeded from the question) if this is the first socket to want
   * it on this instance. Concurrent callers for a brand-new session all await
   * the same promise rather than racing to build two rooms.
   */
  async function getOrCreateRoom(
    sessionId: string,
    questionId: string,
  ): Promise<{ room: Room; created: boolean }> {
    let created = false;
    let promise = rooms.get(sessionId);
    if (!promise) {
      created = true;
      promise = buildRoom(sessionId, questionId, deps, instanceId, () => {
        void endRoom(sessionId);
      });
      promise.catch(() => rooms.delete(sessionId));
      rooms.set(sessionId, promise);
    }
    const room = await promise;
    live.add(room);
    return { room, created };
  }

  /**
   * Drops `socket` from its room. If it was the last one connected, snapshots
   * and tears the room down — the next socket to join re-reads that snapshot
   * in `getOrCreateRoom`, which is the whole reconnect story: nothing is kept
   * in memory once nobody is watching this session.
   */
  async function leaveRoom(sessionId: string, socket: WebSocket): Promise<void> {
    const promise = rooms.get(sessionId);
    if (!promise) return;
    const room = await promise.catch(() => null);
    if (!room) return;

    // Out of `sockets` first. `removeAwarenessStates` fires the awareness
    // listener synchronously, and that listener re-registers any sender still
    // present in the set — so clearing presence before removing the socket
    // puts this very socket back into `socketAwarenessIds`, where it would
    // stay, uncollectable, for the life of the room.
    room.sockets.delete(socket);
    const ids = room.socketAwarenessIds.get(socket);
    room.socketAwarenessIds.delete(socket);
    if (ids && ids.size > 0) {
      removeAwarenessStates(room.awareness, [...ids], socket);
    }

    if (room.sockets.size > 0) return;

    // Snapshot *before* the room leaves the map. A reconnect landing in the
    // gap would otherwise miss this room, rebuild from the previous snapshot
    // — up to 30s stale — and then overwrite this one with it on its own
    // next tick, losing everything typed in between.
    await snapshotDoc(deps.pool, sessionId, room.doc).catch((err: unknown) =>
      deps.log.error({ err, session_id: sessionId }, 'disconnect snapshot failed'),
    );

    // Somebody may have joined while that write was in flight, in which case
    // the room is live again and must not be torn down.
    if (room.sockets.size > 0) return;

    await teardown(sessionId, room);
  }

  /** Releases everything a room holds. The caller decides *whether* to do
   * this; snapshotting first is also the caller's job, since by the time this
   * returns the document is gone. */
  async function teardown(sessionId: string, room: Room): Promise<void> {
    room.closing = true;
    clearInterval(room.snapshotTimer);
    rooms.delete(sessionId);
    live.delete(room);
    await room.subscriber
      .unsubscribe(
        docChannel(sessionId),
        awarenessChannel(sessionId),
        syncChannel(sessionId),
        matchChannel(sessionId),
      )
      .catch(() => {});
    room.subscriber.disconnect();
    // Both hold interval timers of their own — an Awareness re-announces
    // every few seconds until destroyed, which for a torn-down room means
    // publishing to Redis forever.
    room.awareness.destroy();
    room.doc.destroy();
  }

  /**
   * Closes a session for good, because Matching says it ended.
   *
   * Without this, ending only stopped *new* sockets: the participant check
   * refused them, but a socket already open kept accepting edits and the 30s
   * snapshot kept saving them, so the document went on changing after the
   * session was over — and phase 6's summary would read whatever it had
   * drifted to.
   *
   * Ordering matters twice here. `closing` goes up first so nothing else is
   * relayed or published while we work. And the sockets are closed *after* the
   * room leaves the map, so each one's close handler finds nothing in `rooms`
   * and returns immediately rather than racing this teardown.
   */
  async function endRoom(sessionId: string): Promise<void> {
    const promise = rooms.get(sessionId);
    if (!promise) return;
    const room = await promise.catch(() => null);
    if (!room || room.closing) return;

    room.closing = true;
    await snapshotDoc(deps.pool, sessionId, room.doc).catch((err: unknown) =>
      deps.log.error({ err, session_id: sessionId }, 'final snapshot failed'),
    );

    const sockets = [...room.sockets];
    room.sockets.clear();
    await teardown(sessionId, room);

    for (const socket of sockets) socket.close(SESSION_ENDED_CODE, 'session ended');
  }

  async function attachSocket(
    socket: WebSocket,
    sessionId: string,
    questionId: string,
  ): Promise<boolean> {
    // `getOrCreateRoom` does real work before it resolves — a Postgres round
    // trip, and on a new session an HTTP call to Questions. The listeners go
    // on *first*, and anything arriving while we wait is queued: `ws` keeps
    // no backlog for an event that has no listener yet, so a frame sent in
    // that window would simply vanish.
    // One object rather than two variables so the listener below closes over
    // something it can still read after this function has moved on.
    const inbox: { room?: Room; early: Uint8Array[] } = { early: [] };
    let joined = false;

    socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      // The sync/awareness protocol is binary-only; a stray text frame has
      // nothing to dispatch to.
      if (!isBinary) return;
      const frame = toUint8Array(data);
      if (!inbox.room) {
        inbox.early.push(frame);
        return;
      }
      deliver(inbox.room, socket, frame, deps.log);
    });

    socket.on('close', () => {
      if (!joined) return;
      leaveRoom(sessionId, socket).catch((err: unknown) =>
        deps.log.error({ err, session_id: sessionId }, 'leaveRoom failed'),
      );
    });

    const { room, created } = await getOrCreateRoom(sessionId, questionId);

    // The client gave up while the room was being built. The close handler
    // above ran with `joined` still false, so nothing has released the room —
    // and if this socket is the one that created it, leaving now is the only
    // thing that will ever tear it down.
    if (socket.readyState !== socket.OPEN) {
      await leaveRoom(sessionId, socket);
      return created;
    }

    room.sockets.add(socket);
    joined = true;
    sendInitialSync(room, socket);

    // Only now does the listener stop queueing — replaying first would let a
    // frame that arrives mid-replay overtake the ones already waiting.
    for (const frame of inbox.early) deliver(room, socket, frame, deps.log);
    inbox.room = room;
    return created;
  }

  async function snapshotAllRooms(): Promise<void> {
    await Promise.all(
      [...rooms.entries()].map(async ([sessionId, promise]) => {
        const room = await promise.catch(() => null);
        if (!room) return;
        await snapshotDoc(deps.pool, sessionId, room.doc).catch((err: unknown) =>
          deps.log.error({ err, session_id: sessionId }, 'shutdown snapshot failed'),
        );
      }),
    );
  }

  function stats(): { sockets: number; rooms: number } {
    let sockets = 0;
    for (const room of live) sockets += room.sockets.size;
    return { sockets, rooms: live.size };
  }

  return { attachSocket, snapshotAllRooms, stats };
}

async function buildRoom(
  sessionId: string,
  questionId: string,
  deps: RoomDeps,
  instanceId: string,
  onSessionEnded: () => void,
): Promise<Room> {
  const doc = new Y.Doc();
  const snapshot = await loadSnapshot(deps.pool, sessionId);
  Y.applyUpdate(doc, snapshot ?? (await seedUpdate(deps.questionsUrl, questionId)));

  const awareness = new Awareness(doc);
  // Constructing an Awareness registers its own doc as a client with an empty
  // state. The server is not a participant: left in place it shows up in
  // phase 5's cursor UI as a peer who never types, and it re-announces itself
  // to every other instance every few seconds for as long as the room lives.
  awareness.setLocalState(null);

  const sockets = new Set<WebSocket>();
  const socketAwarenessIds = new Map<WebSocket, Set<number>>();

  // A subscribed ioredis connection can't issue any other command, so this is
  // a dedicated one — duplicate() copies the main connection's options
  // without re-reading REDIS_URL. enableOfflineQueue goes back on for it:
  // @deepcs/shared/redis turns the queue off so a user-facing request fails
  // fast instead of hanging, but this is a long-lived listener rather than a
  // request, and subscribing before the socket finishes connecting should
  // queue rather than throw.
  const subscriber = deps.redis.duplicate({ enableOfflineQueue: true });
  try {
    await subscriber.subscribe(
      docChannel(sessionId),
      awarenessChannel(sessionId),
      syncChannel(sessionId),
      matchChannel(sessionId),
    );
  } catch (err) {
    // duplicate() already opened a socket. Without this it would sit there
    // reconnecting for the life of the process, once per failed room build.
    subscriber.disconnect();
    throw err;
  }

  const room: Room = {
    doc,
    awareness,
    sockets,
    socketAwarenessIds,
    subscriber,
    snapshotTimer: setInterval(() => {
      snapshotDoc(deps.pool, sessionId, doc).catch((err: unknown) =>
        deps.log.error({ err, session_id: sessionId }, 'periodic snapshot failed'),
      );
    }, SNAPSHOT_INTERVAL_MS),
    closing: false,
  };

  // messageBuffer, not message: a Yjs update is arbitrary binary, and the
  // string "message" event would run it through UTF-8 (de)coding and silently
  // corrupt it.
  subscriber.on('messageBuffer', (channel: Buffer, message: Buffer) => {
    const name = channel.toString();
    if (name === docChannel(sessionId)) {
      Y.applyUpdate(doc, message, 'redis');
    } else if (name === awarenessChannel(sessionId)) {
      applyAwarenessUpdate(awareness, message, 'redis');
    } else if (name === matchChannel(sessionId)) {
      // Matching's lifecycle channel. Every instance holding this session gets
      // it, which is what makes ending work across instances rather than only
      // on whichever one the person who pressed the button was talking to.
      const event = parseSessionEvent(message);
      if (event?.type === 'session.ended') onSessionEnded();
    } else if (name === syncChannel(sessionId) && message.toString() !== instanceId) {
      // Another instance just opened this session and is asking whoever
      // already holds it for the current state. The reply is the *whole*
      // document rather than a delta: a full state is self-contained, so it
      // integrates regardless of what the asker started from, and it also
      // releases any deltas Yjs parked while the asker was still catching up.
      deps.redis
        .publish(docChannel(sessionId), Buffer.from(Y.encodeStateAsUpdate(doc)))
        .catch((err: unknown) =>
          deps.log.error({ err, session_id: sessionId }, 'state reply failed'),
        );
    }
  });

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (room.closing) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    broadcast(room, encoding.toUint8Array(encoder), origin);

    // An update that arrived via Redis came from another instance, which has
    // already published it — republishing would loop forever.
    if (origin !== 'redis') {
      deps.redis
        .publish(docChannel(sessionId), Buffer.from(update))
        .catch((err: unknown) =>
          deps.log.error({ err, session_id: sessionId }, 'doc update publish failed'),
        );
    }
  });

  awareness.on(
    'update',
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (room.closing) return;

      if (sockets.has(origin as WebSocket)) {
        const ids = socketAwarenessIds.get(origin as WebSocket) ?? new Set<number>();
        for (const id of [...added, ...updated]) ids.add(id);
        for (const id of removed) ids.delete(id);
        socketAwarenessIds.set(origin as WebSocket, ids);
      }

      const update = encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, update);
      broadcast(room, encoding.toUint8Array(encoder), origin);

      if (origin !== 'redis') {
        deps.redis
          .publish(awarenessChannel(sessionId), Buffer.from(update))
          .catch((err: unknown) =>
            deps.log.error({ err, session_id: sessionId }, 'awareness update publish failed'),
          );
      }
    },
  );

  // Ask whoever already holds this session for their state. Nothing waits on
  // a reply: a doc built from a snapshot is up to 30s behind the live one,
  // and until the gap is filled Yjs parks any delta that depends on it. The
  // reply closes the gap and the parked deltas apply themselves.
  await deps.redis
    .publish(syncChannel(sessionId), instanceId)
    .catch((err: unknown) =>
      deps.log.error({ err, session_id: sessionId }, 'state request failed'),
    );

  return room;
}

/** Sends the joining socket a sync step 1 and the room's current presence. */
function sendInitialSync(room: Room, socket: WebSocket): void {
  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(syncEncoder, room.doc);
  socket.send(encoding.toUint8Array(syncEncoder));

  const states = room.awareness.getStates();
  if (states.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      encodeAwarenessUpdate(room.awareness, [...states.keys()]),
    );
    socket.send(encoding.toUint8Array(awarenessEncoder));
  }
}

/** Matching's events are JSON on a channel that also carries `match.created`.
 * A malformed or unknown payload is ignored rather than thrown: this runs in a
 * Redis listener, where an uncaught throw takes the process down. */
function parseSessionEvent(message: Buffer): { type?: string } | null {
  try {
    return JSON.parse(message.toString()) as { type?: string };
  } catch {
    return null;
  }
}

/** Normalizes a `ws` payload — which arrives as a `Buffer`, an `ArrayBuffer`,
 * or, for a fragmented frame, a `Buffer[]` — into one `Uint8Array`. */
export function toUint8Array(data: WebSocket.RawData): Uint8Array {
  const buf = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.isBuffer(data)
      ? data
      : Buffer.from(data);
  return new Uint8Array(buf);
}

/**
 * Applies one frame, and contains the damage if it is malformed.
 *
 * The catch is the load-bearing part. `handleMessage` throws on a truncated
 * frame, an empty one, an unknown sync sub-type, or awareness bytes that
 * aren't JSON — and a throw inside a `ws` listener is not a failed request,
 * it is an uncaughtException that kills the process and every other session
 * on this instance with it. One bad client must only cost that client.
 */
function deliver(room: Room, socket: WebSocket, data: Uint8Array, log: Logger): void {
  try {
    handleMessage(room, socket, data);
  } catch (err) {
    log.error({ err }, 'closing socket after a malformed frame');
    socket.close(1002, 'malformed frame');
  }
}

/** Dispatches one incoming binary message from `socket` into the room. */
function handleMessage(room: Room, socket: WebSocket, data: Uint8Array): void {
  const decoder = decoding.createDecoder(data);
  const messageType = decoding.readVarUint(decoder);

  if (messageType === MESSAGE_SYNC) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, encoder, room.doc, socket);
    // readSyncMessage only writes a reply for sync step 1 (the reply being
    // step 2); a length of 1 is just the message-type byte, i.e. nothing to
    // send back.
    if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
  } else if (messageType === MESSAGE_AWARENESS) {
    applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), socket);
  }
}
