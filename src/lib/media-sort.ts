import type { Prisma } from "@prisma/client";

export const mediaSortGroups = [
  { label: "Home", options: [
    { value: "smart", label: "Automatico · varietà" },
    { value: "random", label: "Casuale" }
  ] },
  { label: "Date", options: [
    { value: "created-desc", label: "Aggiunti: più recenti" }, { value: "created-asc", label: "Aggiunti: più vecchi" },
    { value: "captured-desc", label: "Data ripresa: più recenti" }, { value: "captured-asc", label: "Data ripresa: più vecchi" },
    { value: "updated-desc", label: "Modificati: più recenti" }, { value: "updated-asc", label: "Modificati: più vecchi" }
  ] },
  { label: "Nome e file", options: [
    { value: "name-asc", label: "Titolo: A → Z" }, { value: "name-desc", label: "Titolo: Z → A" },
    { value: "filename-asc", label: "Nome file: A → Z" }, { value: "filename-desc", label: "Nome file: Z → A" },
    { value: "size-desc", label: "Dimensione: più grandi" }, { value: "size-asc", label: "Dimensione: più piccoli" },
    { value: "kind-asc", label: "Tipo: foto prima" }, { value: "kind-desc", label: "Tipo: video prima" }
  ] },
  { label: "Video e immagini", options: [
    { value: "duration-desc", label: "Durata: più lunghi" }, { value: "duration-asc", label: "Durata: più brevi" },
    { value: "resolution-desc", label: "Risoluzione: più alta" }, { value: "resolution-asc", label: "Risoluzione: più bassa" },
    { value: "width-desc", label: "Larghezza: maggiore" }, { value: "width-asc", label: "Larghezza: minore" },
    { value: "height-desc", label: "Altezza: maggiore" }, { value: "height-asc", label: "Altezza: minore" },
    { value: "fps-desc", label: "Frame rate: più alto" }, { value: "fps-asc", label: "Frame rate: più basso" }
  ] },
  { label: "Catalogazione", options: [
    { value: "status-asc", label: "Stato: in attesa prima" }, { value: "status-desc", label: "Stato: errori prima" },
    { value: "favorite-desc", label: "Preferiti prima" }, { value: "favorite-asc", label: "Non preferiti prima" },
    { value: "rating-desc", label: "Valutazione: più alta" }, { value: "rating-asc", label: "Valutazione: più bassa" },
    { value: "people-desc", label: "Più performer" }, { value: "people-asc", label: "Meno performer" },
    { value: "tags-desc", label: "Più tag" }, { value: "tags-asc", label: "Meno tag" },
    { value: "groups-desc", label: "Più gallerie" }, { value: "groups-asc", label: "Meno gallerie" },
    { value: "markers-desc", label: "Più momenti salienti" }, { value: "markers-asc", label: "Meno momenti salienti" }
  ] }
] as const;

export type MediaSort = (typeof mediaSortGroups)[number]["options"][number]["value"];
export function parseMediaSort(value: string | null): MediaSort {
  if (value === "name") return "name-asc";
  return mediaSortGroups.some(({ options }) => options.some((option) => option.value === value)) ? value as MediaSort : "smart";
}

/** Every order ends with an ID tie-breaker for stable pagination. Unknown metadata stays last. */
export function mediaOrderBy(sort: MediaSort): Prisma.MediaAssetOrderByWithRelationInput[] {
  const direction = sort.endsWith("-asc") ? "asc" : "desc";
  const field = sort.split("-")[0];
  const fields = {
    created: "createdAt", updated: "updatedAt", name: "title", size: "bytes", kind: "kind", favorite: "favorite", rating: "rating", status: "status"
  } as const;
  const optionalFields = {
    captured: "capturedAt", filename: "sourceFileName", duration: "durationMs", width: "width", height: "height", fps: "frameRate"
  } as const;
  let primary: Prisma.MediaAssetOrderByWithRelationInput;
  if (field in fields) primary = { [fields[field as keyof typeof fields]]: direction };
  else if (field in optionalFields) primary = { [optionalFields[field as keyof typeof optionalFields]]: { sort: direction, nulls: "last" } };
  else if (["people", "tags", "groups", "markers"].includes(field)) primary = { [field]: { _count: direction } };
  else primary = { capturedAt: { sort: "desc", nulls: "last" } };
  return [primary, { createdAt: "desc" }, { id: "asc" }];
}

export function orderByResolution<T extends { id: string; width: number | null; height: number | null }>(items: readonly T[], sort: "resolution-asc" | "resolution-desc"): T[] {
  const direction = sort === "resolution-asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = a.width && a.height ? a.width * a.height : null;
    const right = b.width && b.height ? b.width * b.height : null;
    if (left === null || right === null) return left === right ? a.id.localeCompare(b.id) : left === null ? 1 : -1;
    return direction * (left - right) || a.id.localeCompare(b.id);
  });
}
