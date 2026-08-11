import { check } from 'k6';
import encoding from 'k6/encoding';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { WebSocket } from 'k6/websockets';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as lib0encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';

/**
 * The load run of DESIGN.md §8: ramp real collaboration sockets onto Collab up
 * to the 250-per-instance ceiling §7 configures, hold them there, and measure
 * how long an edit takes to travel from one member of a pair to the other.
 *
 * Run it with `make load`, which bundles this file first — k6 cannot resolve
 * `node_modules`, so the Yjs libraries are compiled in by load/bundle.mjs.
 *
 * Every VU is one person in one two-person session, so VUs 1 and 2 share a
 * document, 3 and 4 share the next, and so on. The sessions themselves are
 * created in setup() through the real flow — a token, a profile, two calls to
 * /match/join — because Collab authorizes each socket against Matching and
 * there is no way to fake a session it will accept.
 */

const GATEWAY_URL = __ENV.GATEWAY_URL || 'http://gateway:8080';
const WS_URL = __ENV.WS_URL || GATEWAY_URL.replace(/^http/, 'ws');
const PROJECT_ID = __ENV.FIREBASE_PROJECT_ID || 'demo-deepcs';
const TOPIC = __ENV.TOPIC || 'concurrency';
const DIFFICULTY = __ENV.DIFFICULTY || 'medium';

/** Rounded up to an even number: a session needs two people, and an odd VU
 * would be left holding a session index nobody created. */
const PEAK_VUS = 2 * Math.ceil(Number(__ENV.PEAK_VUS || 250) / 2);
const PAIRS = PEAK_VUS / 2;
const HOLD = __ENV.HOLD || '3m';

/**
 * How long one VU keeps its socket before closing and opening another. Shorter
 * than the run on purpose: a socket that is only ever opened proves nothing
 * about the code that closes one, and it is the leave path — snapshot, drop
 * the room, unsubscribe — where a leak would live.
 */
const SOCKET_SECONDS = Number(__ENV.SOCKET_SECONDS || 30);
const EDIT_INTERVAL_MS = Number(__ENV.EDIT_INTERVAL_MS || 1000);

/** The envelope Collab multiplexes on, from services/collab/src/rooms.ts. */
const MESSAGE_SYNC = 0;

/**
 * Time-to-propagate, in milliseconds: the sender writes `Date.now()` into the
 * text it inserts and the partner subtracts it from its own clock on arrival.
 * That subtraction is only meaningful because both VUs are threads of one k6
 * process reading one clock — the same measurement between two machines would
 * be measuring their clock skew as much as the server.
 */
const editLatency = new Trend('edit_latency', true);
const editsSent = new Counter('edits_sent');
const editsReceived = new Counter('edits_received');

export const options = {
  // 250 sessions are created one pair at a time before the run starts.
  setupTimeout: '10m',
  scenarios: {
    collab: {
      executor: 'ramping-vus',
      startVUs: 0,
      // Ramp rather than slam, because a flat run only answers pass/fail and a
      // ramp shows where latency stops being flat (§8).
      stages: [
        { duration: '30s', target: Math.max(2, 2 * Math.round(PEAK_VUS / 10)) },
        { duration: '1m', target: Math.max(2, 2 * Math.round(PEAK_VUS / 10)) },
        { duration: '30s', target: PEAK_VUS },
        { duration: HOLD, target: PEAK_VUS },
        { duration: '30s', target: 0 },
      ],
      // Longer than one socket's life, so a VU being ramped down finishes the
      // iteration it is in rather than having its socket cut mid-measurement.
      gracefulRampDown: `${SOCKET_SECONDS + 15}s`,
      gracefulStop: `${SOCKET_SECONDS + 15}s`,
    },
  },
  thresholds: {
    edit_latency: ['p(95)<200'],
    // Not decoration: a threshold over a metric that recorded nothing passes,
    // so without this a run where no edit ever propagated would look clean.
    edits_received: ['count>0'],
    ws_connecting: ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
};

/** The uid of the n-th test user. VU n takes the n-th uid, which is what puts
 * VUs 1 and 2 in the same session. */
function uidFor(runId, index) {
  return `k6-${runId}-${index}`;
}

/**
 * A token in the shape the Firebase Auth emulator issues: `alg: none` and an
 * empty signature. The Gateway checks `iss`, `aud`, `exp` and `sub` on this
 * path and nothing else (services/gateway/src/auth.ts), which is what lets a
 * load generator mint 250 identities without an emulator round trip per user.
 */
function tokenFor(uid) {
  const header = encoding.b64encode(JSON.stringify({ alg: 'none', typ: 'JWT' }), 'rawurl');
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: uid,
    iat: now,
    exp: now + 4 * 3600,
  };
  return `${header}.${encoding.b64encode(JSON.stringify(claims), 'rawurl')}.`;
}

function authHeaders(token) {
  return { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
}

/**
 * One pair of users through the real matching flow. The first join always
 * answers `waiting` and the second one claims it, so the calls are sequential
 * on purpose: two joins in flight at once can claim each other's partner and
 * the pairing stops matching the VU numbering this script relies on.
 */
function createSession(runId, pair) {
  const ids = [];
  for (const index of [pair * 2, pair * 2 + 1]) {
    const token = tokenFor(uidFor(runId, index));
    // Creates the profile row. Matching validates uids against Users, so a
    // join before this returns 400.
    const profile = http.get(`${GATEWAY_URL}/users/me`, authHeaders(token));
    if (profile.status !== 200 && profile.status !== 201) {
      exec.test.abort(`GET /users/me answered ${profile.status}: ${profile.body}`);
    }
    ids.push(token);
  }

  let session = null;
  for (const token of ids) {
    const body = JSON.stringify({ topic: TOPIC, difficulty: DIFFICULTY });
    const res = http.post(`${GATEWAY_URL}/match/join`, body, authHeaders(token));
    // 201 is the pairing that created a session, 200 the one left waiting.
    if (res.status !== 200 && res.status !== 201) {
      exec.test.abort(`POST /match/join answered ${res.status}: ${res.body}`);
    }
    const parsed = res.json();
    if (parsed.status === 'matched') session = parsed.session.id;
  }

  if (!session) {
    exec.test.abort('two joins on the same topic did not produce a session');
  }
  return { id: session, token: ids[0] };
}

export function setup() {
  const runId = Date.now().toString(36);
  const sessions = [];
  for (let pair = 0; pair < PAIRS; pair++) sessions.push(createSession(runId, pair));
  console.log(`${sessions.length} sessions ready for ${PEAK_VUS} VUs`);
  return { runId, sessions };
}

/**
 * Ends every session the run created. Without this each run leaves its
 * sessions active for ever, and `/stats` starts reporting a system where
 * nobody ever finishes anything.
 */
export function teardown(data) {
  for (const session of data.sessions) {
    // An empty JSON object rather than no body at all: these headers promise
    // JSON, and Fastify rejects a request that declares a body and sends none.
    http.post(`${GATEWAY_URL}/match/sessions/${session.id}/end`, '{}', authHeaders(session.token));
  }
}

/** Reads back the timestamps this script stamped into inserted text. */
const MARKER = /~t(\d+)~/g;

export default function (data) {
  const index = exec.vu.idInTest - 1;
  const session = data.sessions[Math.floor(index / 2)];
  const token = tokenFor(uidFor(data.runId, index));

  const doc = new Y.Doc();
  const text = doc.getText('content');
  let synced = false;
  let editing = null;

  const socket = new WebSocket(`${WS_URL}/collab/connect?sessionId=${session.id}&token=${token}`);
  socket.binaryType = 'arraybuffer';

  /**
   * Only updates that arrived from the server, and only after the initial sync
   * has landed. The first thing the server sends is the whole document, whose
   * markers were stamped by earlier iterations minutes ago — counting those
   * would report the age of the document rather than the latency of an edit.
   */
  text.observe((event, transaction) => {
    if (!synced || transaction.origin !== 'server') return;
    for (const part of event.delta) {
      if (typeof part.insert !== 'string') continue;
      MARKER.lastIndex = 0;
      let match;
      while ((match = MARKER.exec(part.insert)) !== null) {
        editLatency.add(Date.now() - Number(match[1]));
        editsReceived.add(1);
      }
    }
  });

  // Local edits go out as incremental updates, the same shape y-monaco sends
  // from the browser. Anything applied from the server is skipped, or two
  // clients would bounce one edit between them for ever.
  doc.on('update', (update, origin) => {
    if (origin === 'server' || socket.readyState !== 1) return;
    const encoder = lib0encoding.createEncoder();
    lib0encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    socket.send(lib0encoding.toUint8Array(encoder).buffer);
  });

  socket.addEventListener('open', () => {
    const encoder = lib0encoding.createEncoder();
    lib0encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    socket.send(lib0encoding.toUint8Array(encoder).buffer);

    editing = setInterval(() => {
      text.insert(text.length, `~t${Date.now()}~`);
      editsSent.add(1);
    }, EDIT_INTERVAL_MS);

    setTimeout(() => socket.close(), SOCKET_SECONDS * 1000);
  });

  socket.addEventListener('message', (event) => {
    const decoder = decoding.createDecoder(new Uint8Array(event.data));
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
    const reply = lib0encoding.createEncoder();
    lib0encoding.writeVarUint(reply, MESSAGE_SYNC);
    const type = syncProtocol.readSyncMessage(decoder, reply, doc, 'server');
    if (lib0encoding.length(reply) > 1) socket.send(lib0encoding.toUint8Array(reply).buffer);
    // Step 2 is the reply to our step 1, so this is the whole document
    // arriving. Everything after it is a live edit.
    if (type === syncProtocol.messageYjsSyncStep2) synced = true;
  });

  socket.addEventListener('close', (event) => {
    if (editing !== null) clearInterval(editing);
    // The scaffold is seeded from the question, so a document with text in it
    // is proof this socket was authorized, joined a room and was sent state.
    // The close code is logged when it is missing, because a failed check that
    // cannot be told apart from a refused upgrade diagnoses nothing.
    if (!synced) console.warn(`closed before the document arrived, code ${event.code}`);
    check(synced, { 'document synced': (ok) => ok });
  });

  socket.addEventListener('error', (event) => {
    if (editing !== null) clearInterval(editing);
    console.error(`socket error: ${event.error}`);
  });
}
