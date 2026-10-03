export type MediaType = "video" | "image";
export type MediaStatus = "ready" | "processing" | "error";

export interface HighlightMarker {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  color: string;
  note?: string | null;
  featured?: boolean;
}

export interface MediaItem {
  id: string;
  title: string;
  type: MediaType;
  src: string;
  mimeType?: string;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  originalUrl?: string | null;
  streamUrl?: string | null;
  accent: string;
  duration?: string;
  durationMs?: number | null;
  frameRate?: number | null;
  dimensions: string;
  size: string;
  date: string;
  createdAt?: string;
  location?: string;
  people: string[];
  tags: string[];
  group: string;
  galleries?: Array<{ name: string; ownerPersonId?: string | null }>;
  status: MediaStatus;
  favorite?: boolean;
  showOnTv?: boolean;
  hideFromRandomHome?: boolean;
  featured?: boolean;
  markers?: HighlightMarker[];
  duplicateCount?: number;
  sourceFileName?: string;
  sourceMediaId?: string | null;
  sourceTimeMs?: number | null;
  processingStage?: string;
  processingProgress?: number;
  processingState?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  processingError?: string | null;
  aspect: "portrait" | "landscape" | "square" | "wide";
}

export interface ProcessingJobRecord {
  id: string;
  operation: string;
  state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  progress: number;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface PersistedMediaRecord {
  id: string;
  title: string;
  kind: "IMAGE" | "VIDEO";
  status: "UPLOADING" | "PROCESSING" | "READY" | "ERROR";
  mimeType: string;
  bytes: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  frameRate?: number | null;
  createdAt: string;
  dominantColor: string | null;
  favorite: boolean;
  showOnTv: boolean;
  hideFromRandomHome: boolean;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  originalUrl: string;
  streamUrl: string | null;
  sourceFileName?: string | null;
  sourceMediaId?: string | null;
  sourceTimeMs?: number | null;
  jobs?: ProcessingJobRecord[];
  markers?: HighlightMarker[];
  duplicateCount?: number;
  tags: Array<{ name: string }>;
  people: Array<{ name: string }>;
  groups: Array<{ name: string; ownerPersonId?: string | null }>;
}

export interface AdvancedFilterState {
  people: string[];
  excludePeople: string[];
  tags: string[];
  excludeTags: string[];
  groups: string[];
  excludeGroups: string[];
  dateFrom: string;
  dateTo: string;
  duration: "any" | "short" | "medium" | "long";
  resolution: "any" | "4k" | "hd" | "sd";
  status: "any" | "ready" | "processing" | "error";
  markerOnly: boolean;
  duplicateOnly: boolean;
  favoriteOnly: boolean;
}

export const emptyAdvancedFilters: AdvancedFilterState = {
  people: [],
  excludePeople: [],
  tags: [],
  excludeTags: [],
  groups: [],
  excludeGroups: [],
  dateFrom: "",
  dateTo: "",
  duration: "any",
  resolution: "any",
  status: "any",
  markerOnly: false,
  duplicateOnly: false,
  favoriteOnly: false
};
