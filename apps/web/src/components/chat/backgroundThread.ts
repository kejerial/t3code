import { createContext } from "react";

/**
 * True for a thread whose global shortcuts and focus grabs stand down: one kept mounted under
 * Settings or Usage, or one in a split view pane that is not focused.
 */
export const BackgroundThreadContext = createContext(false);

export interface SplitPaneInfo {
  /** Panes on screen; above one, each pane is too narrow for an inline right panel. */
  readonly count: number;
  /** The focused pane drives the route and owns the window's titlebar controls. */
  readonly focused: boolean;
  readonly first: boolean;
  readonly last: boolean;
  /** Focused by something other than the user's own click or keystroke here, so the caret moves in. */
  readonly takeFocus: boolean;
  /** A side chat: in the background for shortcuts, yet it takes the caret when it opens. */
  readonly aside: boolean;
  /** Closes this pane; null when it is the only one. A side chat's close deletes its thread. */
  readonly onClose: (() => void) | null;
}

export const SplitPaneContext = createContext<SplitPaneInfo>({
  count: 1,
  focused: true,
  first: true,
  last: true,
  takeFocus: true,
  aside: false,
  onClose: null,
});
