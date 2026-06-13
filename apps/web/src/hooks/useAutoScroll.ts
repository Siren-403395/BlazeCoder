/**
 * Stick-to-bottom scrolling for the conversation stream. Scrolls to the latest
 * content when `dep` changes, but only while the user is already near the
 * bottom - if they scroll up to read history, we leave them there.
 */

import { useEffect, useRef } from "react";

const THRESHOLD = 72;

export function useAutoScroll<T>(dep: T) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD;
  };

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);

  return { ref, onScroll };
}
