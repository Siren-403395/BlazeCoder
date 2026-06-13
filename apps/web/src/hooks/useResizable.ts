/**
 * A horizontal resize handle for a side panel. `width` is the panel's width in
 * px, measured during a pointer drag from whichever container edge the panel is
 * anchored to (`side`), then clamped and persisted. The container is the resize
 * handle's parent element, so no ref threading is needed. A right-anchored panel
 * grows as the handle is dragged left, so keyboard arrows invert accordingly.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  storageKey: string;
  initial: number;
  min: number;
  max: number;
  /** Which container edge the panel hugs. Defaults to "left". */
  side?: "left" | "right";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function useResizable({ storageKey, initial, min, max, side = "left" }: Options) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof localStorage === "undefined") return initial;
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? clamp(saved, min, max) : initial;
  });
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(Math.round(width)));
    } catch {
      /* ignore */
    }
  }, [storageKey, width]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      const container = e.currentTarget.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      draggingRef.current = true;
      setDragging(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        const next = side === "right" ? rect.right - ev.clientX : ev.clientX - rect.left;
        setWidth(clamp(next, min, max));
      };
      const onUp = () => {
        draggingRef.current = false;
        setDragging(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [min, max, side],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // A right-anchored panel grows when the handle moves left, so the arrow
      // keys mean the opposite of what they do for a left-anchored panel.
      const dir = side === "right" ? -1 : 1;
      const step = e.shiftKey ? 1 : 16;
      let delta = 0;
      switch (e.key) {
        case "ArrowLeft":
          delta = -step * dir;
          break;
        case "ArrowRight":
          delta = step * dir;
          break;
        case "Home":
          e.preventDefault();
          setWidth(min);
          return;
        case "End":
          e.preventDefault();
          setWidth(max);
          return;
        default:
          return;
      }
      e.preventDefault();
      setWidth((w) => clamp(w + delta, min, max));
    },
    [min, max, side],
  );

  return { width, dragging, onPointerDown, onKeyDown, min, max };
}
