"use client";

import { ANSWER_LENGTH_LABEL, type AnswerLength } from "@homestorm/shared";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const LENGTH_LABEL = ANSWER_LENGTH_LABEL;

/**
 * A seat's answer length (ADR 0012): the room rule by default, or its own. null means "follow the room rule", and
 * the option names what that is right now.
 */
export function AnswerLengthSelect({
  value,
  onChange,
  roomRule,
}: {
  value: AnswerLength | null;
  onChange: (v: AnswerLength | null) => void;
  roomRule: AnswerLength;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Answer length</Label>
      <Select
        value={value ?? "room"}
        onValueChange={(v) => onChange(v === "room" ? null : (v as AnswerLength))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="room">Room rule (now {LENGTH_LABEL[roomRule]})</SelectItem>
          <SelectItem value="concise">Concise, always</SelectItem>
          <SelectItem value="detailed">Detailed, always</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Your message can still ask for longer or shorter on any turn.
      </p>
    </div>
  );
}
