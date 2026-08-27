export type Theme = "system" | "light" | "dark";

const KEY = "sr_theme";
const mql = () => window.matchMedia("(prefers-color-scheme: dark)");

export function loadTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function saveTheme(t: Theme): void {
  localStorage.setItem(KEY, t);
}

export function isDark(t: Theme): boolean {
  return t === "dark" || (t === "system" && mql().matches);
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = isDark(t) ? "dark" : "light";
}

export function subscribeSystem(cb: () => void): () => void {
  const m = mql();
  const onChange = () => cb();
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}
