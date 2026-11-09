"use client";

import { WEB_ACCESS_LABEL, type WebAccess } from "@homestorm/shared";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Short names, for the room rule and the "Room rule (now …)" option. */
export const WEB_LABEL = WEB_ACCESS_LABEL;

/** What the seat card says when a seat has its own setting. */
export const WEB_CARD_LABEL: Record<WebAccess, string> = {
  off: "no web tools",
  on: "web tools",
  must: "searches first",
};

/**
 * What a seat may do on the web (ADR 0017): the room rule by default, or its own. null means "follow the room rule",
 * and the option names what that is right now.
 */
export function WebAccessSelect({
  value,
  onChange,
  roomRule,
}: {
  value: WebAccess | null;
  onChange: (v: WebAccess | null) => void;
  roomRule: WebAccess;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Web tools</Label>
      <Select
        value={value ?? "room"}
        onValueChange={(v) => onChange(v === "room" ? null : (v as WebAccess))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="room">Room rule (now {WEB_LABEL[roomRule]})</SelectItem>
          <SelectItem value="off">Off, always</SelectItem>
          <SelectItem value="on">Can search and read pages, always</SelectItem>
          <SelectItem value="must">Must search before answering, always</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        What it looks up shows under its answer. Answers get slower and use more allowance. In a
        blind round, seats that search may read different sources.
      </p>
    </div>
  );
}
