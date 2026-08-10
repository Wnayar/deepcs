import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { GATEWAY_WS_URL } from './config';

/**
 * The browser half of the Collab protocol.
 *
 * There is no `y-websocket` here on purpose. The server side was written
 * directly against `y-protocols` (see the note in pnpm-workspace.yaml), so its
 * framing is this project's own and a stock provider would not speak it. It is
 * about eighty lines either way, and writing it means the wire format is
 * visible rather than hidden behind a dependency.
 */

/** The outer envelope. `y-protocols/sync` has its own message types *inside* a
 * sync message — step 1, step 2, update — which is a level below these. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/**
 * What the UI needs to tell the user, and the reason it is not simply
 * "connected or not".
 *
 * A rejection looks different depending on which layer caught it, because
 * `@fastify/http-proxy` completes the handshake with the browser *before* it
 * dials Collab. A bad token is refused by the Gateway and the socket never
 * opens. A refusal from Collab — not a participant, or the session has ended —
 * arrives as a socket that opens and then closes having delivered nothing.
 * Those are different messages to show, so they are different states.
 */
export type CollabStatus = 'connecting' | 'connected' | 'unauthorized' | 'refused' | 'closed';

export interface CollabHandle {
  doc: Y.Doc;
  awareness: Awareness;
  destroy: () => void;
}

export interface CollabOptions {
  sessionId: string;
  token: string;
  /** Shown on the other person's cursor. */
  displayName: string;
  onStatus: (status: CollabStatus) => void;
}

const RECONNECT_DELAY_MS = 1_500;

export function connectCollab({
  sessionId,
  token,
  displayName,
  onStatus,
}: CollabOptions): CollabHandle {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);

  let socket: WebSocket | null = null;
  let closedByUs = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (payload: Uint8Array) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(payload);
  };

  /** A local edit. Anything whose origin is the server came *from* the socket,
   * and echoing it back would loop. */
  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'server') return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    send(encoding.toUint8Array(encoder));
  };

  const onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === 'server') return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]),
    );
    send(encoding.toUint8Array(encoder));
  };

  doc.on('update', onDocUpdate);
  awareness.on('update', onAwarenessUpdate);

  const connect = () => {
    onStatus('connecting');
    // The token rides in the query because a browser's WebSocket constructor
    // cannot set an Authorization header. The Gateway reads it only for
    // upgrade requests, so this does not widen how ordinary routes authenticate.
    const url = `${GATEWAY_WS_URL}/collab/connect?sessionId=${encodeURIComponent(
      sessionId,
    )}&token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    socket = ws;

    let opened = false;
    let received = 0;

    ws.addEventListener('open', () => {
      opened = true;
      onStatus('connected');
      // Ask for the document. The server's step 2 reply is how the scaffold
      // and everything typed before now arrives.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      ws.send(encoding.toUint8Array(encoder));

      awareness.setLocalStateField('user', {
        name: displayName,
        color: colorFor(displayName),
      });
    });

    ws.addEventListener('message', (event: MessageEvent<ArrayBuffer>) => {
      received += event.data.byteLength;
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, reply, doc, 'server');
        // Only a step 1 produces a reply; length 1 is the type byte alone.
        if (encoding.length(reply) > 1) ws.send(encoding.toUint8Array(reply));
      } else if (messageType === MESSAGE_AWARENESS) {
        applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), 'server');
      }
    });

    ws.addEventListener('close', () => {
      if (closedByUs) return onStatus('closed');

      if (!opened) {
        // Never upgraded: the Gateway rejected the token before Collab was
        // ever contacted. Retrying will not help.
        return onStatus('unauthorized');
      }
      if (received === 0) {
        // Opened but delivered nothing — Collab refused it. Either this user
        // is not a participant, or the session has ended. Also terminal.
        return onStatus('refused');
      }

      // A real connection that dropped. The room rebuilds from its Postgres
      // snapshot on the server side, so reconnecting resumes where we left off.
      onStatus('connecting');
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });

    // 'error' always precedes 'close', which carries the information we need,
    // so this exists only to stop an unhandled event.
    ws.addEventListener('error', () => {});
  };

  connect();

  return {
    doc,
    awareness,
    destroy: () => {
      closedByUs = true;
      clearTimeout(reconnectTimer);
      doc.off('update', onDocUpdate);
      awareness.off('update', onAwarenessUpdate);
      socket?.close();
      awareness.destroy();
      doc.destroy();
    },
  };
}

/** A stable colour per name, so the same person keeps one cursor colour. */
function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash}, 70%, 45%)`;
}
