# Debugging — failing interactions, error recovery, the canvas-text trap

When a `duo click` / `duo eval` / `duo type` doesn't do what you expected,
this is the triage playbook: which ring buffer to read, how to recover
from a failing selector, and why a rich-looking page can return empty text
(the canvas-text trap that makes `duo ax` necessary).

## Contents

- [Diagnose a failing interaction with the page](#diagnose-a-failing-interaction-with-the-page)
- [Error recovery](#error-recovery)
- [The canvas-text trap (why ax exists)](#the-canvas-text-trap-why-ax-exists)

## Diagnose a failing interaction with the page

If a `duo click` or `duo eval` doesn't produce the expected result, the
page probably logged a warning, threw an uncaught exception, or
returned a non-2xx from an API. Three ring buffers cover those:
`console` (logs + warnings), `errors` (uncaught exceptions, populated
by `Runtime.exceptionThrown`), and `network` (HTTP request lifecycle).
Grab a timestamp before the action so you can scope each one:

```bash
TS=$(date +%s000)
duo click "button.flaky"
sleep 1
duo console --since $TS --level warn,error
duo errors  --since $TS              # uncaught exceptions never reach `console`
duo network --since $TS --filter '/api/'   # XHR/fetch responses + failures
```

Common failure modes and which buffer to check first:
- "Looks like nothing happened" → `errors` (a thrown exception aborts a
  click handler before any `console.error` runs).
- "Spinner forever, no UI update" → `network --filter '/api/'` for 4xx/5xx
  or `failed: true` entries.
- "Page logged something I want to see" → `console`.

Each `network` entry includes `{url, method, status, statusText, mimeType,
encodedDataLength, failed, errorText, startTs, endTs}`. Use the regex
`--filter` to scope to one origin / route — the ring buffer is bounded
(~300 entries), so a noisy SPA can otherwise crowd out the request you
care about.

## Error recovery

When a selector fails:

1. Confirm the element actually exists:
   ```bash
   duo eval "!!document.querySelector('YOUR_SELECTOR')"
   ```
2. Inspect the surrounding DOM:
   ```bash
   duo dom | grep -i "part_of_the_text"
   ```
3. Re-issue `duo focus` immediately before `duo type` — focus is easy to
   lose between commands, especially in canvas apps.
4. For canvas apps, never assume `duo text` captured anything meaningful;
   switch to `duo ax`.
5. Retry transient navigation/timing errors up to three times before
   declaring the operation impossible.

## The canvas-text trap (why `ax` exists)

```bash
# This will return almost nothing on a Google Doc, even if the doc is huge.
duo text --selector ".kix-appview-canvas"
```

Canvas elements have no text children. Google Docs, Sheets, Slides, Figma,
and newer Notion surfaces all fall into this pattern. If a page looks rich
but `duo text` returns a short string or chrome-only content, assume canvas
rendering and retry with `duo ax`.
