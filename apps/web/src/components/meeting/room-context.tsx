"use client";

import type { Limits, MeetingState, Message, ModelInfo, Poll, Seat } from "@homestorm/shared";
import { createContext, useContext } from "react";

export interface Room {
  id: string;
  state: MeetingState;
  limits: Record<string, Limits | null>;
  /** llmgw's models by ID, for context windows; empty until loaded. */
  models: Map<string, ModelInfo>;
  /** The Standard context budget; null until the model list has loaded. */
  standardContextBudget: number | null;
  /** mcpgw answers, so the web features can be offered (ADR 0014). */
  webTools: boolean;
  /** mcpgw offers code_run (ADR 0021). */
  codeRun: boolean;
  thinking: Record<string, number>;
  /** A round is running: new questions wait. */
  running: boolean;
  seatById: Map<string, Seat>;
  seatName: (id: string | null) => string;
  /** Run an API call; a failure shows as a notice instead of disappearing. */
  act: (fn: () => Promise<unknown>) => Promise<boolean>;
  openReply: (target: Message) => void;
  openWrapUp: () => void;
  /** Open the poll dialog (ADR 0020), optionally with a poll to start from. */
  openPoll: (start?: Poll) => void;
  /** Open the brief editor, optionally pre-filled (e.g. a wrap-up to copy in). */
  openBrief: (draft?: string) => void;
  openEditSeat: (seat: Seat) => void;
}

export const RoomContext = createContext<Room | null>(null);

export function useRoom(): Room {
  const room = useContext(RoomContext);
  if (!room) throw new Error("useRoom() used outside a meeting");
  return room;
}
