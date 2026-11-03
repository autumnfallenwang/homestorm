"use client";

import type { Limits, MeetingState, Message, Seat } from "@homestorm/shared";
import { createContext, useContext } from "react";

export interface Room {
  id: string;
  state: MeetingState;
  limits: Record<string, Limits | null>;
  thinking: Record<string, number>;
  /** A round is running: new questions wait. */
  running: boolean;
  seatById: Map<string, Seat>;
  seatName: (id: string | null) => string;
  /** Run an API call; a failure shows as a notice instead of disappearing. */
  act: (fn: () => Promise<unknown>) => Promise<boolean>;
  openReply: (target: Message) => void;
  openWrapUp: () => void;
  openEditSeat: (seat: Seat) => void;
}

export const RoomContext = createContext<Room | null>(null);

export function useRoom(): Room {
  const room = useContext(RoomContext);
  if (!room) throw new Error("useRoom() used outside a meeting");
  return room;
}
