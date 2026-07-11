// ============================================================
// Minimal Socket.IO v4 (Engine.IO v4) client for k6.
//
// k6 has no socket.io client, only raw WebSockets. socket.io v4
// frames every message with the Engine.IO + Socket.IO protocol, so
// this module implements just enough of it to authenticate, join a
// room, emit commands and receive events against the game gateway.
//
// Server: socket.io ^4.8.1  => Engine.IO protocol 4 (EIO=4).
// Transport: websocket only (no long-poll upgrade dance).
//
// Frame reference (string frames):
//   Engine.IO packet = <engineType><data>
//     "0" OPEN     -> server sends handshake JSON, we reply namespace-connect
//     "1" CLOSE
//     "2" PING     -> we must reply "3" (PONG)
//     "3" PONG
//     "4" MESSAGE  -> body is a Socket.IO packet
//   Socket.IO packet (inside a MESSAGE) = <sioType>[namespace,][ackId][json]
//     "0" CONNECT       (we send "40/game," ; server acks "40/game,{sid}")
//     "1" DISCONNECT
//     "2" EVENT         ["eventName", payload]
//     "3" ACK
//     "4" CONNECT_ERROR
// ============================================================

import { WebSocket } from "k6/experimental/websockets";
import { NAMESPACE } from "./protocol.js";

const ENGINE = { OPEN: "0", CLOSE: "1", PING: "2", PONG: "3", MESSAGE: "4" };
const SIO = {
  CONNECT: "0",
  DISCONNECT: "1",
  EVENT: "2",
  ACK: "3",
  CONNECT_ERROR: "4",
};

// Parse a Socket.IO packet body (everything after the Engine.IO "4").
function decodeSocketPacket(s) {
  const sioType = s.charAt(0);
  let i = 1;
  let namespace = "/";

  if (s.charAt(i) === "/") {
    const comma = s.indexOf(",", i);
    if (comma === -1) {
      namespace = s.slice(i);
      i = s.length;
    } else {
      namespace = s.slice(i, comma);
      i = comma + 1;
    }
  }

  // Optional numeric ack id — skip it (we don't use acks).
  let j = i;
  while (j < s.length && s.charAt(j) >= "0" && s.charAt(j) <= "9") j++;
  i = j;

  let data = null;
  const payloadStr = s.slice(i);
  if (payloadStr) {
    try {
      data = JSON.parse(payloadStr);
    } catch (_e) {
      data = null;
    }
  }
  return { sioType, namespace, data };
}

// Open a socket.io connection and return a small client facade.
//
// opts:
//   namespace  - default "/game"
//   auth       - object sent in the CONNECT packet (socket.handshake.auth).
//                Left null here: the game gateway uses a message-based
//                AUTHENTICATE flow (mirrors the web client), so callers
//                emit `authenticate` after `ready` resolves.
//   onClose / onError - optional lifecycle hooks.
export function createSocketIOClient(wsBase, opts = {}) {
  const namespace = opts.namespace || NAMESPACE;
  const auth = opts.auth || null;
  const url = `${wsBase}/socket.io/?EIO=4&transport=websocket`;

  const ws = new WebSocket(url);
  const eventHandlers = {}; // event -> [cb]
  const anyHandlers = []; // (event, payload) -> void
  const waiters = {}; // event -> [{ resolve, reject, timer }]
  let closed = false;
  let intentionalClose = false;

  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const client = {
    ws,
    namespace,
    connected: false,
    ready,

    on(event, cb) {
      (eventHandlers[event] || (eventHandlers[event] = [])).push(cb);
      return client;
    },

    onAny(cb) {
      anyHandlers.push(cb);
      return client;
    },

    emit(event, payload) {
      const arr = payload === undefined ? [event] : [event, payload];
      const frame =
        ENGINE.MESSAGE + SIO.EVENT + namespace + "," + JSON.stringify(arr);
      try {
        ws.send(frame);
      } catch (_e) {
        /* socket already closing */
      }
      return client;
    },

    // Resolve on the next occurrence of `event`, reject after timeoutMs.
    waitFor(event, timeoutMs) {
      return new Promise((resolve, reject) => {
        const rec = { resolve, reject, timer: null };
        rec.timer = setTimeout(() => {
          const list = waiters[event] || [];
          const idx = list.indexOf(rec);
          if (idx >= 0) list.splice(idx, 1);
          reject(new Error(`timeout waiting for '${event}' (${timeoutMs}ms)`));
        }, timeoutMs);
        (waiters[event] || (waiters[event] = [])).push(rec);
      });
    },

    close() {
      if (closed) return;
      intentionalClose = true;
      closed = true;
      try {
        ws.close();
      } catch (_e) {
        /* already closed */
      }
    },
  };

  function dispatch(event, payload) {
    for (let i = 0; i < anyHandlers.length; i++) {
      try {
        anyHandlers[i](event, payload);
      } catch (_e) {
        /* handler must not break the loop */
      }
    }
    const hs = eventHandlers[event];
    if (hs) {
      for (let i = 0; i < hs.length; i++) {
        try {
          hs[i](payload);
        } catch (_e) {
          /* ignore */
        }
      }
    }
    const pending = waiters[event];
    if (pending && pending.length) {
      waiters[event] = [];
      for (let i = 0; i < pending.length; i++) {
        clearTimeout(pending[i].timer);
        pending[i].resolve(payload);
      }
    }
  }

  function handleRaw(raw) {
    const data = typeof raw === "string" ? raw : String(raw);
    if (!data) return;

    const engineType = data.charAt(0);

    if (engineType === ENGINE.PING) {
      try {
        ws.send(ENGINE.PONG);
      } catch (_e) {
        /* closing */
      }
      return;
    }

    if (engineType === ENGINE.OPEN) {
      // Engine.IO handshake received -> connect to our namespace.
      const authStr = auth ? JSON.stringify(auth) : "";
      try {
        ws.send(ENGINE.MESSAGE + SIO.CONNECT + namespace + "," + authStr);
      } catch (_e) {
        /* closing */
      }
      return;
    }

    if (engineType !== ENGINE.MESSAGE) return;

    const pkt = decodeSocketPacket(data.slice(1));
    if (pkt.namespace !== namespace) return;

    if (pkt.sioType === SIO.CONNECT) {
      client.connected = true;
      resolveReady(pkt.data || {});
      return;
    }
    if (pkt.sioType === SIO.CONNECT_ERROR) {
      rejectReady(
        new Error(`connect_error: ${JSON.stringify(pkt.data || {})}`),
      );
      return;
    }
    if (pkt.sioType === SIO.EVENT) {
      const arr = pkt.data || [];
      dispatch(arr[0], arr[1]);
      return;
    }
    // DISCONNECT / ACK: nothing to do for the load client.
  }

  ws.onmessage = (e) => handleRaw(e.data);
  ws.onerror = (e) => {
    rejectReady(new Error("websocket error"));
    if (opts.onError) opts.onError(e);
  };
  ws.onclose = () => {
    closed = true;
    if (opts.onClose) opts.onClose(intentionalClose);
  };

  return client;
}
