"use client";

import { createContext, useContext } from "react";

/**
 * Host capability + room id, shared with the participant tiles so they can offer server-mediated
 * moderation (mute / remove) inline without prop-drilling through every layout. `canManage` mirrors
 * the join grant (room.manage); the actual authority is still enforced server-side.
 */
export interface CallControlValue {
  canManage: boolean;
  roomId: string;
  /**
   * The waiting-room manage credential (= the room's host_token). Present for any host joiner,
   * including the no-login host link — moderation routes to it so an unregistered teacher can mute/
   * remove without a session. null → fall back to the session-authenticated room endpoints.
   */
  manageToken: string | null;
}

export const CallControlContext = createContext<CallControlValue>({
  canManage: false,
  roomId: "",
  manageToken: null,
});

export function useCallControl(): CallControlValue {
  return useContext(CallControlContext);
}
