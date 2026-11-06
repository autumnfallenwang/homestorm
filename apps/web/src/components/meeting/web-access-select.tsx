"use client";

import type { WebAccess } from "@homestorm/shared";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Whether a seat may use the web (ADR 0014). The chair's own "Search the web" is separate, and always fair to all. */
export function WebAccessSelect({
  value,
  onChange,
}: {
  value: WebAccess;
  onChange: (v: WebAccess) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Web tools</Label>
      <Select value={value} onValueChange={(v) => onChange(v as WebAccess)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">Off</SelectItem>
          <SelectItem value="on">Can search and read pages</SelectItem>
          <SelectItem value="must">Must search before answering</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        What it looks up shows under its answer. Answers get slower and use more allowance. In a
        blind round, seats that search may read different sources.
      </p>
    </div>
  );
}
