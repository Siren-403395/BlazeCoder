/** Theme preference (dark / light / system) with persistence and live OS sync. */

import { useCallback, useEffect, useState } from "react";

export type ThemePref = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const KEY = "ca-theme";

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolve(pref: ThemePref): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}

function apply(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    if (typeof localStorage === "undefined") return "dark";
    const saved = localStorage.getItem(KEY) as ThemePref | null;
    return saved ?? "dark";
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(pref));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* storage may be unavailable */
    }
    const next = resolve(pref);
    apply(next);
    setResolved(next);

    if (pref !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const r: ResolvedTheme = mq.matches ? "light" : "dark";
      apply(r);
      setResolved(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const toggle = useCallback(() => {
    setPref((p) => (resolve(p) === "dark" ? "light" : "dark"));
  }, []);

  return { pref, resolved, setPref, toggle };
}
