export type MediaType = "video" | "image";
export type MediaStatus = "ready" | "processing" | "error";

export interface MediaItem {
  id: string;
  title: string;
  type: MediaType;
  src: string;
  accent: string;
  duration?: string;
  dimensions: string;
  size: string;
  date: string;
  location?: string;
  people: string[];
  tags: string[];
  group: string;
  status: MediaStatus;
  favorite?: boolean;
  featured?: boolean;
  aspect: "portrait" | "landscape" | "square" | "wide";
}
