# 0021: Python for seats, through mcpgw's code_run

- **Status:** accepted, built 2026-11-10
- **Date:** 2026-11-10

## Context

- **Seats do sums in their heads.** The full meeting test on the cluster (2026-11-08) had four seats work out tax on a
  quote, price per TB, months of space left and upload days at 20 Mbit/s, each by hand. They agreed, but nothing
  checked them.
- **mcpgw has `code_run` now** (mcpgw ADR 0014, deployed 2026-11-10): Python 3.14 with numpy, pandas, scipy and sympy,
  in Pyodide under Deno, in a pod that reaches nothing. Its ADR ends: "homestorm has to offer it to seats".
- **homestorm was already offering it, by accident.** Seats with web tools got mcpgw's whole tool list, and
  `code_run` joined it on 2026-11-10. homestorm couldn't run it ("There's no tool called code_run"), and the prompt
  only spoke of the web tools. No seat had called it yet.

## Decision

**Python is a room rule like web tools (ADR 0017), on by default, and homestorm offers exactly the tools a seat may
use.**

- **The setting:** Python, On or Off, in Room rules; each seat follows it unless it has its own ("Can run Python,
  always" or "Off, always"). Shown only when mcpgw lists `code_run`. Changes add event lines. New and existing
  meetings start On (migration 0010): it has no network, so it can't leak the meeting, and it costs only a run's time.
- **What a seat is offered:** the web tools by its web setting, `code_run` by its Python setting, and only tools
  mcpgw lists. A tool mcpgw adds later is never offered until homestorm runs it. None in a wrap-up or a poll.
- **The prompt:** a Python section (use it for arithmetic, totals, conversions and comparisons instead of working
  them out in your head; put the numbers in the code; give the result, not the code). The 6 calls a turn are shared
  with searches and page reads, and each result says how many are left.
- **"Must search first" with Python** (changed the same day, after a live test where a seat searched "calculator"
  before a sum): the seat picks its first tool, search for facts or Python for sums, and is told to check with a
  tool before answering. An answer with no tool at all is thrown away and a search is forced, so it never answers
  from memory alone. Without Python, the first call is a forced search as before.
- **Plain-text maths:** the intro asks for maths as plain text, not LaTeX, which homestorm doesn't render (GPT-6 Luna
  wrote `\mathbf{$1,313.25}`).
- **The record:** each run keeps its code and up to 2,000 characters of what it printed (the seat itself reads up to
  mcpgw's 16,000). Under the answer it shows as "Ran Python (3 lines)", opening to the code and the output. A Python
  error shows in amber with its last line ("ZeroDivisionError: division by zero"); the seat read the whole error and
  can fix the code. Other seats see "Ran Python twice" with the answer, as they see "Searched".
- **The export** gives each run as a Python block and an output block, so a number can be traced.

## Alternatives considered

- **Python only with web tools on.** Rejected: sums matter most when there's nothing to look up, and web tools are
  off by default.
- **Always on, with no setting.** Rejected: a chair may want a seat to reason without it, and every other capability
  in a meeting is a room rule.
- **Off by default.** Rejected: it's sandboxed with no network, the chair can turn it off, and the user asked for it
  to be used.
- **A separate budget of calls for Python.** Rejected for now: 6 shared calls keep a turn's time bounded, and the
  calls-left note lets a seat choose.

## Consequences

- **More seats now have a tool:** a seat with web tools off gets `code_run`, so its turn can take more than one step.
- **mcpgw's limits apply:** 20 s per run, two at once with the rest queued, no packages beyond Pyodide's, no files.
- **New mcpgw tools need homestorm's code** before seats get them, by design.
