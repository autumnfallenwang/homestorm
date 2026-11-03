"use client";

import {
  type ModelInfo,
  prettyModelName,
  type ReasoningEffort,
  type Source,
  sourceFamily,
} from "@homestorm/shared";
import { Loader2, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, type ModelsResponse } from "@/lib/api";
import { allowanceLine, compareModels } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRoom } from "./room-context";
import { SeatAvatar } from "./source";

const SOURCE_ORDER: Source[] = ["anthropic", "openai-codex", "deepseek"];
const SOURCE_TITLE: Record<Source, string> = {
  anthropic: "Claude subscription",
  "openai-codex": "ChatGPT subscription",
  deepseek: "DeepSeek prepaid",
};

/** Add a seat: models grouped by source with each source's allowance (ADR 0007). */
export function AddSeatDialog() {
  const { id, state, act } = useRoom();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ModelInfo | null>(null);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [effort, setEffort] = useState<ReasoningEffort>("low");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    api
      .listModels()
      .then(setData, (e) => setLoadError(e instanceof Error ? e.message : "Couldn't load models."));
  }, [open]);

  const inMeeting = new Set(state.seats.filter((s) => !s.removedAt).map((s) => s.model));
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const models = (data?.models ?? [])
      // Dated aliases (claude-haiku-4-5-20251001) duplicate their short name.
      .filter((m) => !/-\d{8}$/.test(m.id))
      .filter((m) => !q || m.id.includes(q) || prettyModelName(m.id).toLowerCase().includes(q))
      .sort((a, b) => Number(b.available) - Number(a.available) || compareModels(a.id, b.id));
    return SOURCE_ORDER.map((src) => ({
      src,
      models: models.filter((m) => m.ownedBy === src),
    })).filter((g) => g.models.length);
  }, [data, query]);

  function reset() {
    setPicked(null);
    setName("");
    setPersona("");
    setEffort("low");
    setQuery("");
  }

  async function add() {
    if (!picked) return;
    setBusy(true);
    const ok = await act(() =>
      api.addSeat(id, {
        model: picked.id,
        displayName: name.trim() || undefined,
        persona: persona.trim() || undefined,
        reasoningEffort: effort,
      }),
    );
    setBusy(false);
    if (ok) {
      setOpen(false);
      reset();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7">
          <Plus className="size-3.5" />
          Add seat
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a seat</DialogTitle>
          <DialogDescription>
            Pick a model from llmgw. The seat always uses exactly this model.
          </DialogDescription>
        </DialogHeader>

        {!picked ? (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                aria-label="Search models"
                placeholder="Search models"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="-mx-1 max-h-[55vh] space-y-4 overflow-y-auto px-1">
              {!data && !loadError && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading models from llmgw…
                </p>
              )}
              {loadError && <p className="text-sm text-destructive">{loadError}</p>}
              {groups.map(({ src, models }) => (
                <section key={src}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <h3 className="text-xs font-semibold">{SOURCE_TITLE[src]}</h3>
                    <span className="text-xs text-muted-foreground">
                      {allowanceLine(data?.families[src]).text}
                    </span>
                  </div>
                  <ul className="space-y-0.5">
                    {models.map((m) => {
                      const there = inMeeting.has(m.id);
                      return (
                        <li key={m.id}>
                          <button
                            type="button"
                            disabled={!m.available}
                            onClick={() => {
                              setPicked(m);
                              setName(prettyModelName(m.id));
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:hover:bg-transparent",
                            )}
                          >
                            <SeatAvatar name={prettyModelName(m.id)} source={m.ownedBy} size="sm" />
                            <span
                              className={cn(
                                "min-w-0 flex-1",
                                !m.available && "text-muted-foreground line-through",
                              )}
                            >
                              <span className="block truncate text-sm">
                                {prettyModelName(m.id)}
                              </span>
                              <span className="block truncate font-mono text-[0.6875rem] text-muted-foreground">
                                {m.id}
                              </span>
                            </span>
                            {!m.available ? (
                              <span className="text-xs text-muted-foreground">
                                Not on your plan
                              </span>
                            ) : there ? (
                              <span className="text-xs text-muted-foreground">In this meeting</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border p-2.5">
              <SeatAvatar name={name || prettyModelName(picked.id)} source={picked.ownedBy} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{prettyModelName(picked.id)}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {picked.id} · {sourceFamily(picked.ownedBy)}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                Change
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seat-name">Display name</Label>
              <Input
                id="seat-name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seat-persona">
                Persona <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="seat-persona"
                value={persona}
                maxLength={2000}
                rows={3}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="e.g. Play the skeptic. Push back on anything that adds operational cost."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Thinking effort</Label>
              <Select value={effort} onValueChange={(v) => setEffort(v as ReasoningEffort)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low (fast, the default)</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High (slow, spends more allowance)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={add} disabled={!picked || busy}>
            {busy && <Loader2 className="animate-spin" />}
            Add seat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
