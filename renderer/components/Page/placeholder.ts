// TODO (BUG-034 / Stage 17a.5 D, 2026-04-29) — installPlaceholder is
// currently NOT called from PageTab. The bug: refresh() ran at install
// time without an `isJustBoilerplate(doc)` check, so the onboarding card
// rendered on EVERY canvas open and occluded real content on populated
// files. The MutationObserver-driven dismiss only fires on the next
// mutation, which on read-only viewing may never happen.
//
// Re-enabling correctly requires gating the initial install on
// `isJustBoilerplate(doc)` (function below at line ~206) — only mount the
// overlay when the body content is purely boilerplate at install time.
// The MutationObserver-driven dismissal stays as the dismiss path.
// Owner re-enables this as part of the Stage 17a.5 onboarding refresh.
//
// Original design notes preserved below.
//
// Stage 17a polish item 7 + 17a.5 direction D — smart-blank onboarding
// overlay on fresh + empty canvas pages.
//
// Design exploration card (s17a5-design): "Smart-blank with baked-in
// onboarding. Boilerplate stays bare visually but the page mounts with
// an inline overlay: 'Press / for blocks · Pick a starter ↗ · Ask the
// agent to draft this for you ↘'. Dismisses on first keystroke."
//
// Implementation: a non-editable card overlay that shows when the body
// has no meaningful content. Toggled by a MutationObserver on body.
// The overlay is marked `data-duo-canvas-runtime="1"` so serialize.ts
// strips it on save — it never lands on disk. Dismiss happens
// automatically as soon as the first user content appears (the
// observer detects the change and removes the overlay).
//
// Today only the "markdown shortcuts" door is interactive (item 1
// ships those). The other two doors foreshadow Stage 17e (slash
// menu) and Stage 17f (agent draft UI). They're rendered as muted
// "coming soon" hints rather than clickable buttons so we don't
// commit to those interaction surfaces before they ship.

const PLACEHOLDER_ID = 'duo-canvas-placeholder'
const STYLE_ID = 'duo-canvas-placeholder-style'

export function installPlaceholder(doc: Document): () => void {
  if (!doc.body) return () => {}

  // Inject the stylesheet once per document.
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = STYLE_ID
    // Runtime-only marker so serialize.ts strips this <style> on save.
    style.setAttribute('data-duo-canvas-runtime', '1')
    style.textContent = `
      #${PLACEHOLDER_ID} {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        max-width: 520px;
        padding: 20px 24px;
        font-family: -apple-system, system-ui, sans-serif;
        color: #555;
        background: #fbfaf6;
        border: 1px solid #e8e3d5;
        border-radius: 8px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.05);
        pointer-events: none;
        user-select: none;
        text-align: left;
      }
      #${PLACEHOLDER_ID} .duo-door {
        display: flex;
        align-items: baseline;
        gap: 10px;
        padding: 8px 0;
        font-size: 13px;
        line-height: 1.5;
      }
      #${PLACEHOLDER_ID} .duo-door + .duo-door {
        border-top: 1px solid #ece6d6;
      }
      #${PLACEHOLDER_ID} .duo-tag {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 2px 8px;
        border-radius: 999px;
      }
      #${PLACEHOLDER_ID} .duo-tag-active {
        color: #6d531c;
        background: #f3e2b6;
      }
      #${PLACEHOLDER_ID} .duo-tag-soon {
        color: #999;
        background: #f0eee6;
      }
      #${PLACEHOLDER_ID} .duo-door-body {
        flex: 1;
      }
      #${PLACEHOLDER_ID} .duo-door-title {
        color: #333;
        font-weight: 500;
      }
      #${PLACEHOLDER_ID} .duo-door-soon .duo-door-title {
        color: #888;
      }
      #${PLACEHOLDER_ID} .duo-door-hint {
        color: #888;
        font-size: 12px;
        margin-top: 1px;
      }
      #${PLACEHOLDER_ID} kbd {
        display: inline-block;
        padding: 1px 6px;
        font-family: -apple-system, ui-monospace, monospace;
        font-size: 11px;
        background: #f6f1e2;
        border: 1px solid #e6deca;
        border-radius: 4px;
        color: #5a4a1f;
      }
    `
    doc.head?.appendChild(style)
  }

  // Dismiss-on-first-input semantics (design card direction D).
  // We mount the overlay once; the first user keystroke removes it and
  // we never re-add. This is friendlier than "show whenever empty"
  // because it doesn't fight the user when they edit the title h1
  // back to its original boilerplate-shaped state.
  let dismissed = false

  const dismiss = () => {
    if (dismissed) return
    dismissed = true
    doc.getElementById(PLACEHOLDER_ID)?.remove()
  }

  const refresh = () => {
    if (dismissed) return
    const existing = doc.getElementById(PLACEHOLDER_ID)
    if (!existing) {
      const overlay = doc.createElement('div')
      overlay.id = PLACEHOLDER_ID
      overlay.contentEditable = 'false'
      // Runtime-only marker so serialize.ts strips this overlay on save.
      overlay.setAttribute('data-duo-canvas-runtime', '1')
      overlay.innerHTML = `
        <div class="duo-door duo-door-active">
          <span class="duo-tag duo-tag-active">type</span>
          <div class="duo-door-body">
            <div class="duo-door-title">Markdown shortcuts work as you type</div>
            <div class="duo-door-hint">
              <kbd>#</kbd> heading · <kbd>-</kbd> bullet · <kbd>&gt;</kbd> quote ·
              <kbd>**bold**</kbd> · <kbd>_italic_</kbd> · <kbd>---</kbd> hr · <kbd>\`\`\`</kbd> code
            </div>
          </div>
        </div>
        <div class="duo-door duo-door-soon">
          <span class="duo-tag duo-tag-soon">soon</span>
          <div class="duo-door-body">
            <div class="duo-door-title">Component blocks via <kbd>/</kbd></div>
            <div class="duo-door-hint">callout, table, status badge, … (slash menu ships in 17e)</div>
          </div>
        </div>
        <div class="duo-door duo-door-soon">
          <span class="duo-tag duo-tag-soon">soon</span>
          <div class="duo-door-body">
            <div class="duo-door-title">Start from a template</div>
            <div class="duo-door-hint">status report, one-pager, decision log, … (gallery ships in 17a.5)</div>
          </div>
        </div>
        <div class="duo-door duo-door-soon">
          <span class="duo-tag duo-tag-soon">soon</span>
          <div class="duo-door-body">
            <div class="duo-door-title">Ask the agent to draft this</div>
            <div class="duo-door-hint">UI ships in 17f · today: <kbd>duo html new</kbd> + <kbd>duo html replace</kbd> from a Duo terminal</div>
          </div>
        </div>
      `
      doc.body.appendChild(overlay)
    }
  }

  refresh()
  // Dismiss on the user's first input. `input` fires for any user-driven
  // text change (typing, paste, formatBlock from a toolbar action that
  // mutates user-editable content). It does NOT fire for our own
  // programmatic mutations (DOM mutations done outside contentEditable
  // edits don't fire `input` events), so the overlay survives the
  // ID-injection probe and other startup-time canvas mutations.
  doc.body.addEventListener('input', dismiss)
  // Defensive: if a programmatic mutation lands real content (e.g.
  // an agent op via duo html append), also dismiss. We don't want to
  // pop the overlay back up after that.
  const observer = new MutationObserver(() => {
    // Only dismiss if there's now meaningful content beyond the
    // boilerplate. Avoids flapping during ID-injection probes etc.
    if (!isJustBoilerplate(doc)) dismiss()
  })
  observer.observe(doc.body, {
    subtree: true,
    childList: true,
    characterData: true
  })
  return () => {
    observer.disconnect()
    doc.body.removeEventListener('input', dismiss)
    doc.getElementById(PLACEHOLDER_ID)?.remove()
  }
}

/** Detects "the canvas is still in its newly-opened, no-real-content
 *  state". Used by the MutationObserver fallback to decide whether
 *  programmatic mutations have introduced enough content to dismiss
 *  the overlay. The shape we expect of a fresh boilerplate canvas:
 *    body
 *      h1   ← the title from `duo html new --title …`
 *      p    ← empty
 *  Plus any runtime-injected nodes (placeholder, runtime style). If
 *  the body's meaningful structure goes beyond this — third element,
 *  filled p, etc. — we consider real content present. */
function isJustBoilerplate(doc: Document): boolean {
  const body = doc.body
  if (!body) return false
  const meaningful = Array.from(body.childNodes).filter(n => {
    if (n.nodeType !== 1) return false  // ignore whitespace text nodes
    const el = n as Element
    if (el.id === PLACEHOLDER_ID) return false
    if (el.hasAttribute('data-duo-canvas-runtime')) return false
    return true
  }) as Element[]
  if (meaningful.length === 0) return true
  if (meaningful.length === 1) {
    const only = meaningful[0]
    if ((only.tagName === 'P' || only.tagName === 'DIV') && isElementEmpty(only)) {
      return true
    }
  }
  if (meaningful.length === 2) {
    const [first, second] = meaningful
    const isHeading = /^H[1-6]$/.test(first.tagName)
    const isEmptyBlock = (second.tagName === 'P' || second.tagName === 'DIV') && isElementEmpty(second)
    if (isHeading && isEmptyBlock) return true
  }
  return false
}

function isElementEmpty(el: Element): boolean {
  const text = (el.textContent ?? '').replace(/ /g, '').trim()
  if (text.length > 0) return false
  return Array.from(el.children).every(c => c.tagName === 'BR')
}
