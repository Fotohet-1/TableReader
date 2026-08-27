export type Theme = "system" | "light" | "dark";

const KEY = "sr_theme";
const mql = () => window.matchMedia("(prefers-color-scheme: dark)");

export function loadTheme(): Theme {
  const v = localStorage.getItem(KEY);
  // 默认浅色：未显式选择过主题的新用户直接进入浅色模式。
  return v === "light" || v === "dark" ? v : "light";
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
