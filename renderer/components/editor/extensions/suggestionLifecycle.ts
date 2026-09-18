// BUG-271 — the ONE popover lifecycle shared by WikilinkSuggestion ('[[')
// and AtMention ('@'). Both files used to carry a byte-identical copy of
// this state machine, which is how the "persistent popover" family of bugs
// (walk-1 v4, walk-2 v2/v3, BUG-271) kept needing the same fix twice.
//
// The TipTap Suggestion plugin only ever closes a session from a
// transaction INSIDE its own editor. Duo keeps inactive file tabs mounted
// under display:none (WorkingPane), so an editor hidden mid-session never
// gets that transaction: its popover — portaled to document.body — outlives
// the tab switch and, because a hidden anchor measures as an all-zero rect,
// snaps to the window's top-left corner over every other tab.
//
// States:
//   dismissed — the user closed this session on purpose (Escape, or a
//     pick via Enter/Tab). Stays closed until the plugin's onExit; typing
//     more characters must NOT bring it back.
//   suspended — the HOST hid the editor (tab went inactive). The popover is
//     torn down, but the session is still wanted: the next onUpdate (the
//     user came back and kept typing) remounts it at the real caret.
//
// The remount is gated on 'suspended' specifically, never on a bare null
// component: when a session moves AND changes, the plugin calls
// onExit -> onUpdate -> onStart in that order, so remounting on "component
// is null" would mount twice and leak the first popover.

import { ReactRenderer } from '@tiptap/react'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import {
  SuggestionPopover,
  type SuggestionItem,
  type SuggestionPopoverHandle,
  type SuggestionPopoverProps
} from '../primitives/SuggestionPopover'

/** The slice of ReactRenderer the lifecycle uses — narrow so tests can
 *  drive the state machine with a fake instead of a live editor. */
export interface MountedPopover {
  updateProps: (props: Partial<SuggestionPopoverProps>) => void
  destroy: () => void
  ref: SuggestionPopoverHandle | null
}

export type MountPopover = (
  popoverProps: SuggestionPopoverProps,
  suggestion: SuggestionProps
) => MountedPopover

export interface SuggestionLifecycle {
  /** Pass as the Suggestion utility's 'render' option. */
  render: () => {
    onStart: (props: SuggestionProps) => void
    onUpdate: (props: SuggestionProps) => void
    onKeyDown: (props: SuggestionKeyDownProps) => boolean
    onExit: () => void
  }
  /** Host hook — call when the editor stops being visible. Tears the
   *  popover down without ending the session (see 'suspended' above).
   *  No-op when nothing is open or the user already dismissed it. */
  suspend: () => void
}

const HIDDEN_PROPS: SuggestionPopoverProps = {
  items: [],
  command: () => {},
  clientRect: null,
  loading: false,
  visible: false
}

const mountWithReactRenderer: MountPopover = (popoverProps, suggestion) =>
  new ReactRenderer<SuggestionPopoverHandle, SuggestionPopoverProps>(SuggestionPopover, {
    props: popoverProps,
    editor: suggestion.editor
  })

export function createSuggestionLifecycle(
  isLoading: () => boolean,
  mountPopover: MountPopover = mountWithReactRenderer
): SuggestionLifecycle {
  let component: MountedPopover | null = null
  let dismissed = false
  let suspended = false

  const liveProps = (props: SuggestionProps): SuggestionPopoverProps => ({
    items: props.items,
    command: (item: SuggestionItem) => props.command(item),
    clientRect: props.clientRect ?? null,
    loading: isLoading(),
    visible: !dismissed
  })

  // Hide first (SuggestionPopover renders null on visible:false, so the
  // user sees it go immediately), then destroy on the next microtask —
  // ReactRenderer's portal teardown is async and a stale DOM node can
  // otherwise linger for a frame (walk-2 v3). The doomed instance is
  // captured so a remount landing before the microtask is never the one
  // that gets destroyed.
  const hideThenDestroy = () => {
    const doomed = component
    component = null
    if (!doomed) return
    doomed.updateProps(HIDDEN_PROPS)
    queueMicrotask(() => doomed.destroy())
  }

  return {
    suspend() {
      if (!component || dismissed) return
      suspended = true
      hideThenDestroy()
    },
    render: () => ({
      onStart(props) {
        dismissed = false
        suspended = false
        component = mountPopover(liveProps(props), props)
      },
      onUpdate(props) {
        if (!component && suspended) {
          suspended = false
          component = mountPopover(liveProps(props), props)
          return
        }
        // Even when dismissed, keep updateProps flowing with
        // visible:false so the tree stays consistent until onExit.
        component?.updateProps(liveProps(props))
      },
      onKeyDown(props) {
        if (props.event.key === 'Escape') {
          if (dismissed) return false
          dismissed = true
          hideThenDestroy()
          return true
        }
        if (dismissed) return false
        const handled = component?.ref?.onKeyDown(props.event) ?? false
        if (handled && (props.event.key === 'Enter' || props.event.key === 'Tab')) {
          dismissed = true
          component?.updateProps(HIDDEN_PROPS)
        }
        return handled
      },
      onExit() {
        dismissed = false
        suspended = false
        component?.destroy()
        component = null
      }
    })
  }
}
