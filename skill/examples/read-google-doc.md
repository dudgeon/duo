# Example: Read a Google Doc

**Scenario:** The user has a PRD open in Google Docs and wants Claude to read
and suggest edits.

```bash
# 1. Navigate to the doc (user must already be logged into Google)
duo navigate "https://docs.google.com/document/d/YOUR_DOC_ID/edit"

# 2. Wait for the Kix editor canvas to load
duo wait ".kix-appview-canvas" --timeout 10000

# 3. Read the visible text
duo text --selector ".kix-appview-canvas"
```

**Notes:**

- The `.kix-appview-canvas` selector targets the Google Docs editor viewport.
  If it times out, the SSO session may have expired — ask the user to log in
  via the browser pane and retry.
- For very long docs, use `duo eval` to extract just a section:
  ```bash
  duo eval "Array.from(document.querySelectorAll('.kix-paragraphrenderer')).slice(0,20).map(el => el.innerText).join('\n')"
  ```
- Google Docs renders lazily; scroll position affects which paragraphs are
  in the DOM. Use `duo eval window.scrollTo(0,0)` before reading if you
  need content from the top.
