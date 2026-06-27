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
}

export const CallControlContext = createContext<CallControlValue>({
  canManage: false,
  roomId: "",
});

export function useCallControl(): CallControlValue {
  return useContext(CallControlContext);
}
