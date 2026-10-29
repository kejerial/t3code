import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { type RefObject, useEffect, useEffectEvent, useSyncExternalStore } from "react";

export const THREAD_CONTEXT_DROP_EVENT = "t3-thread-context-drop";

/** The half of the drop target the pointer is over; split panes open on that side. */
export type ThreadDropSide = "before" | "after";

interface ThreadContextDropDetail {
  readonly threads: ReadonlyArray<ScopedThreadRef>;
  readonly side: ThreadDropSide;
}

export function useThreadContextDrop(
  targetRef: RefObject<EventTarget | null>,
  environmentId: EnvironmentId | null,
  targetKey: string,
  onDrop: (
    refs: ReadonlyArray<ScopedThreadRef>,
    isActive: () => boolean,
    side: ThreadDropSide,
  ) => void,
) {
  const handleDrop = useEffectEvent(onDrop);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes the target element to thread-context drop events and marks old drops inactive
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    let active = true;
    const listener = (event: Event) => {
      const { threads, side } = (event as CustomEvent<ThreadContextDropDetail>).detail;
      handleDrop(threads, () => active, side);
    };
    target.addEventListener(THREAD_CONTEXT_DROP_EVENT, listener);
    return () => {
      active = false;
      target.removeEventListener(THREAD_CONTEXT_DROP_EVENT, listener);
    };
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new environment or target ends the previous listener, so isActive reports false to drops still in flight for it.
    environmentId,
    targetKey,
    targetRef,
  ]);
}

const DROP_TARGET_ATTRIBUTE = "data-thread-context-drop";
const DROP_OVER_ATTRIBUTE = "data-thread-context-over";

export interface ThreadContextDragGhost {
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly count: number;
}

let ghost: ThreadContextDragGhost | null = null;
const listeners = new Set<() => void>();

function setGhost(next: ThreadContextDragGhost | null) {
  if (ghost === next) return;
  ghost = next;
  for (const listener of listeners) listener();
}

export function useThreadContextDragGhost(): ThreadContextDragGhost | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => ghost,
    () => null,
  );
}

let overTarget: HTMLElement | null = null;

function findDropTarget(point: { x: number; y: number }): HTMLElement | null {
  return (
    document
      .elementFromPoint(point.x, point.y)
      ?.closest<HTMLElement>(`[${DROP_TARGET_ATTRIBUTE}]`) ?? null
  );
}

function dropSide(target: HTMLElement, point: { x: number }): ThreadDropSide {
  const bounds = target.getBoundingClientRect();
  return point.x < bounds.left + bounds.width / 2 ? "before" : "after";
}

export function moveThreadContextDrag(
  point: { x: number; y: number },
  label: { title: string; count: number },
) {
  const target = findDropTarget(point);
  if (target !== overTarget) overTarget?.removeAttribute(DROP_OVER_ATTRIBUTE);
  target?.setAttribute(DROP_OVER_ATTRIBUTE, dropSide(target, point));
  overTarget = target;
  setGhost({ x: point.x, y: point.y, ...label });
}

export function endThreadContextDrag() {
  overTarget?.removeAttribute(DROP_OVER_ATTRIBUTE);
  overTarget = null;
  setGhost(null);
}

export function dropThreadContext(
  point: { x: number; y: number },
  threads: ReadonlyArray<ScopedThreadRef>,
): boolean {
  const target = findDropTarget(point);
  if (!target || threads.length === 0) return false;
  const detail: ThreadContextDropDetail = { threads, side: dropSide(target, point) };
  target.dispatchEvent(new CustomEvent(THREAD_CONTEXT_DROP_EVENT, { detail }));
  return true;
}

export function threadContextDropTargetProps() {
  return { [DROP_TARGET_ATTRIBUTE]: "true" } as const;
}
