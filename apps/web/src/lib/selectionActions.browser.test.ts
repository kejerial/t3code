import { describe, expect, it, vi } from "vite-plus/test";

import { observeSelectionActions } from "./selectionActions";

function releaseClick(element: HTMLElement, detail: number) {
  const init = { bubbles: true, button: 0, clientX: 40, clientY: 20, detail };
  element.dispatchEvent(new PointerEvent("pointerdown", { ...init, isPrimary: true }));
  element.dispatchEvent(new MouseEvent("mouseup", init));
}

describe("observeSelectionActions", () => {
  it.each([
    { clicks: "single", detail: 1, pointer: { x: 40, y: 20 } },
    { clicks: "double", detail: 2, pointer: null },
  ])("anchors a $clicks-click selection at $pointer", async ({ detail, pointer }) => {
    const element = document.body.appendChild(document.createElement("div"));
    const onSelection = vi.fn();
    const actions = observeSelectionActions({ element, onSelection, onDismiss: () => {} });
    try {
      releaseClick(element, detail);
      await vi.waitFor(() => expect(onSelection).toHaveBeenCalledWith(pointer));
    } finally {
      actions.dispose();
      element.remove();
    }
  });
});
