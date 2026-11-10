"use client";

import { CODE_ACCESS_LABEL, type CodeAccess } from "@homestorm/shared";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Whether a seat may run Python (ADR 0021): the room rule by default, or its own. null means "follow the room rule",
 * and the option names what that is right now.
 */
export function CodeAccessSelect({
  value,
  onChange,
  roomRule,
}: {
  value: CodeAccess | null;
  onChange: (v: CodeAccess | null) => void;
  roomRule: CodeAccess;
}) {
  // Names the dropdown for screen readers: a Label alone isn't tied to Radix's trigger button.
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Python</Label>
      <Select
        value={value ?? "room"}
        onValueChange={(v) => onChange(v === "room" ? null : (v as CodeAccess))}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="room">Room rule (now {CODE_ACCESS_LABEL[roomRule]})</SelectItem>
          <SelectItem value="off">Off, always</SelectItem>
          <SelectItem value="on">Can run Python, always</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        For sums, totals and comparisons done exactly, in a sandbox with no network. The code and
        its output show under the answer.
      </p>
    </div>
  );
}
