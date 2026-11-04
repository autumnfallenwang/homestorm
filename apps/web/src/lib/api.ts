// HTTP client for the homestorm API. Every call sends the session cookie.

import type {
  AddSeatInput,
  AttachmentInput,
  Limits,
  Meeting,
  MeetingState,
  MeetingSummary,
  Message,
  ModelInfo,
  Round,
  Seat,
  SendActionInput,
  Source,
  UpdateMeetingInput,
  UpdateSeatInput,
  WrapUpInput,
} from "@homestorm/shared";

/** The API's base URL: baked at build time for the browser (NEXT_PUBLIC_API_URL), local dev otherwise. */
export function apiBaseUrl(): string {
  if (typeof window === "undefined") {
    return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const parsed = (await res.json().catch(() => null)) as
    | (T & { error?: string; message?: string })
    | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      parsed?.error ?? parsed?.message ?? `Request failed (${res.status})`,
    );
  }
  return parsed as T;
}

export interface ModelsResponse {
  models: ModelInfo[];
  families: Partial<Record<Source, Limits | null>>;
  /** The Standard context budget (the server's VIEW_TOKEN_BUDGET). */
  standardContextBudget: number;
}

export const api = {
  listMeetings: () => request<MeetingSummary[]>("GET", "/api/meetings"),
  createMeeting: (title: string, brief?: string) =>
    request<Meeting>("POST", "/api/meetings", { title, ...(brief?.trim() ? { brief } : {}) }),
  setBrief: (
    id: string,
    content: string,
    files: { keepAttachmentIds?: string[]; attachments?: AttachmentInput[] } = {},
  ) =>
    request<{ changed: boolean; message: Message | null }>("PUT", `/api/meetings/${id}/brief`, {
      content,
      ...files,
    }),
  attachmentUrl: (meetingId: string, attachmentId: string) =>
    `${apiBaseUrl()}/api/meetings/${meetingId}/attachments/${attachmentId}`,
  getMeeting: (id: string) => request<MeetingState>("GET", `/api/meetings/${id}`),
  updateMeeting: (id: string, patch: UpdateMeetingInput) =>
    request<Meeting>("PATCH", `/api/meetings/${id}`, patch),
  deleteMeeting: (id: string) => request<void>("DELETE", `/api/meetings/${id}`),
  listModels: () => request<ModelsResponse>("GET", "/api/models"),
  limits: (id: string) =>
    request<Record<string, Limits | null>>("GET", `/api/meetings/${id}/limits`),
  addSeat: (id: string, input: AddSeatInput) =>
    request<Seat>("POST", `/api/meetings/${id}/seats`, input),
  updateSeat: (id: string, seatId: string, patch: UpdateSeatInput) =>
    request<Seat>("PATCH", `/api/meetings/${id}/seats/${seatId}`, patch),
  moveSeat: (id: string, seatId: string, direction: "up" | "down") =>
    request<Seat[]>("POST", `/api/meetings/${id}/seats/${seatId}/move`, { direction }),
  removeSeat: (id: string, seatId: string) =>
    request<void>("DELETE", `/api/meetings/${id}/seats/${seatId}`),
  send: (id: string, action: SendActionInput) =>
    request<{ message: Message | null; round: Round | null }>(
      "POST",
      `/api/meetings/${id}/actions`,
      action,
    ),
  wrapUp: (id: string, input: WrapUpInput) =>
    request<Round>("POST", `/api/meetings/${id}/wrap-up`, input),
  stop: (id: string, messageId?: string) =>
    request<{ ok: true }>("POST", `/api/meetings/${id}/stop`, messageId ? { messageId } : {}),
  retry: (id: string, messageId: string) =>
    request<Round>("POST", `/api/meetings/${id}/messages/${messageId}/retry`, {}),
  keep: (id: string, messageId: string) =>
    request<Message>("POST", `/api/meetings/${id}/messages/${messageId}/keep`, {}),
  skip: (id: string, messageId: string) =>
    request<Message>("POST", `/api/meetings/${id}/messages/${messageId}/skip`, {}),
  post: (id: string, messageId: string) =>
    request<Message>("POST", `/api/meetings/${id}/messages/${messageId}/post`, {}),
  exportUrl: (id: string) => `${apiBaseUrl()}/api/meetings/${id}/export.md`,
  eventsUrl: (id: string) => `${apiBaseUrl()}/api/meetings/${id}/events`,
};
