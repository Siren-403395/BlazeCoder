/**
 * A horizontal resize handle for a left panel. `width` is its width in px,
 * measured from the parent container's left edge during a pointer drag, clamped
 * and persisted. The container is the resize handle's parent element, so no ref
 * threading is needed.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  storageKey: string;
  initial: number;
  min: number;
  max: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function useResizable({ storageKey, initial, min, max }: Options) {
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
      const left = container.getBoundingClientRect().left;
      draggingRef.current = true;
      setDragging(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        setWidth(clamp(ev.clientX - left, min, max));
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
    [min, max],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let delta = 0;
      switch (e.key) {
        case "ArrowLeft":
          delta = e.shiftKey ? -1 : -16;
          break;
        case "ArrowRight":
          delta = e.shiftKey ? 1 : 16;
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
    [min, max],
  );

  return { width, dragging, onPointerDown, onKeyDown, min, max };
}
