// ============================================================
// Socket Store - Zustand
// Composed via Zustand Slice Pattern
// ============================================================

import { create } from "zustand";
import type { SocketState } from "./socket-store.types";
import { createConnectionSlice } from "./slices/connection.slice";
import { createAuthSlice } from "./slices/auth.slice";
import { createRoomSlice } from "./slices/room.slice";
import { createMatchSlice } from "./slices/match.slice";
import { createCardSlice } from "./slices/card.slice";

export const useSocketStore = create<SocketState>((...a) => ({
  ...createConnectionSlice(...a),
  ...createAuthSlice(...a),
  ...createRoomSlice(...a),
  ...createMatchSlice(...a),
  ...createCardSlice(...a),
}));

export * from "./socket-store.types";
export * from "./socket-store.helpers";
