// The demo has no shared database: retain its selection in this browser only.
export const demoTvStorageKey = "frameo-demo-tv-selection";

export function readDemoTvSelection(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(demoTvStorageKey) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set(); }
}

export function saveDemoTvSelection(ids: string[], included: boolean) {
  const selected = readDemoTvSelection();
  for (const id of ids) {
    if (included) selected.add(id); else selected.delete(id);
  }
  localStorage.setItem(demoTvStorageKey, JSON.stringify([...selected]));
}
