import type { MediaItem } from "@/types/media";

const demoAsset = (name: string) => `/demo/${name}.svg`;

export const demoMedia: MediaItem[] = [
  {
    id: "coastline-drive",
    title: "Coastline Drive",
    type: "video",
    src: demoAsset("coast"),
    accent: "#88A4A0",
    duration: "01:24",
    dimensions: "3840 × 2160",
    size: "1.8 GB",
    date: "24 lug 2026",
    location: "Eagle Bay, AU",
    people: ["Sofia", "Luca"],
    tags: ["viaggio", "estate", "drone"],
    group: "Australia 2026",
    status: "ready",
    favorite: true,
    featured: true,
    duplicateCount: 1,
    durationMs: 84000,
    originalUrl: null,
    markers: [
      { id: "mk-coast-1", label: "Curva sull'oceano", startMs: 12000, endMs: 20500, color: "#6D5DFB", featured: true },
      { id: "mk-coast-2", label: "Golden light", startMs: 44200, endMs: 51700, color: "#E5A348", featured: true }
    ],
    aspect: "wide"
  },
  {
    id: "stillness",
    title: "Stillness at 06:14",
    type: "image",
    src: demoAsset("mountain"),
    accent: "#89957D",
    dimensions: "6240 × 4160",
    size: "18.4 MB",
    date: "22 lug 2026",
    location: "Dolomiti, IT",
    people: [],
    tags: ["montagna", "alba"],
    group: "Nord",
    status: "ready",
    aspect: "landscape"
  },
  {
    id: "concrete-rhythm",
    title: "Concrete Rhythm",
    type: "video",
    src: demoAsset("city"),
    accent: "#777A80",
    duration: "00:42",
    durationMs: 42000,
    dimensions: "4096 × 2160",
    size: "684 MB",
    date: "19 lug 2026",
    location: "Milano, IT",
    people: ["Elena"],
    tags: ["architettura", "b&w"],
    group: "Urban studies",
    status: "ready",
    markers: [
      { id: "mk-concrete-1", label: "Geometria perfetta", startMs: 8200, endMs: 14800, color: "#36A27A", featured: true }
    ],
    aspect: "portrait"
  },
  {
    id: "blue-hour",
    title: "Blue hour / Take 03",
    type: "image",
    src: demoAsset("mountain"),
    accent: "#71879D",
    dimensions: "5472 × 3648",
    size: "12.7 MB",
    date: "17 lug 2026",
    people: [],
    tags: ["paesaggio", "blu"],
    group: "Moodboard",
    status: "ready",
    aspect: "square"
  },
  {
    id: "studio-elena",
    title: "Elena — Studio 04",
    type: "image",
    src: demoAsset("portrait"),
    accent: "#A98A78",
    dimensions: "4480 × 6720",
    size: "24.1 MB",
    date: "15 lug 2026",
    location: "Torino, IT",
    people: ["Elena"],
    tags: ["ritratto", "editoriale"],
    group: "Portraits",
    status: "ready",
    favorite: true,
    aspect: "portrait"
  },
  {
    id: "salt-and-air",
    title: "Salt & Air",
    type: "video",
    src: demoAsset("sea"),
    accent: "#637E85",
    duration: "02:08",
    durationMs: 128000,
    dimensions: "3840 × 2160",
    size: "2.4 GB",
    date: "12 lug 2026",
    people: ["Luca"],
    tags: ["mare", "surf", "slow motion"],
    group: "Summer reel",
    status: "ready",
    markers: [
      { id: "mk-salt-1", label: "Onda lunga", startMs: 31800, endMs: 40400, color: "#4B91D1", featured: true },
      { id: "mk-salt-2", label: "Cutback", startMs: 79900, endMs: 86200, color: "#E76F51", featured: true }
    ],
    aspect: "landscape"
  },
  {
    id: "facade-12",
    title: "Façade no. 12",
    type: "image",
    src: demoAsset("city"),
    accent: "#A5A398",
    dimensions: "6000 × 4000",
    size: "16.8 MB",
    date: "10 lug 2026",
    location: "Barcelona, ES",
    people: [],
    tags: ["architettura", "texture"],
    group: "Urban studies",
    status: "ready",
    duplicateCount: 1,
    aspect: "landscape"
  },
  {
    id: "first-light",
    title: "First Light",
    type: "video",
    src: demoAsset("coast"),
    accent: "#A48162",
    duration: "00:58",
    durationMs: 58000,
    dimensions: "1920 × 1080",
    size: "412 MB",
    date: "08 lug 2026",
    people: ["Sofia"],
    tags: ["alba", "camera a mano"],
    group: "Shorts",
    status: "ready",
    markers: [
      { id: "mk-light-1", label: "Primo raggio", startMs: 4600, endMs: 11200, color: "#E5A348", featured: true }
    ],
    aspect: "wide"
  },
  {
    id: "jonas-test",
    title: "Jonas / Light test",
    type: "image",
    src: demoAsset("portrait"),
    accent: "#8E7569",
    dimensions: "4000 × 5000",
    size: "10.2 MB",
    date: "05 lug 2026",
    people: ["Jonas"],
    tags: ["ritratto", "test"],
    group: "Portraits",
    status: "ready",
    aspect: "portrait"
  },
  {
    id: "lake-house",
    title: "Lake House selects",
    type: "video",
    src: demoAsset("lake"),
    accent: "#8A9074",
    duration: "03:12",
    durationMs: 192000,
    dimensions: "3840 × 2160",
    size: "3.1 GB",
    date: "02 lug 2026",
    people: ["Sofia", "Elena", "Luca"],
    tags: ["weekend", "friends"],
    group: "Lake House",
    status: "ready",
    markers: [
      { id: "mk-lake-1", label: "Tutti sul pontile", startMs: 56400, endMs: 65100, color: "#6D5DFB", featured: true }
    ],
    aspect: "landscape"
  },
  {
    id: "transcode-queued",
    title: "CAM_A_0728",
    type: "video",
    src: demoAsset("lake"),
    accent: "#787E75",
    duration: "—",
    dimensions: "3840 × 2160",
    size: "4.7 GB",
    date: "oggi, 11:42",
    people: [],
    tags: [],
    group: "Da catalogare",
    status: "processing",
    aspect: "landscape"
  }
];

export const people = [
  { name: "Sofia", count: 128, src: demoAsset("avatar-sofia") },
  { name: "Luca", count: 96, src: demoAsset("avatar-luca") },
  { name: "Elena", count: 74, src: demoAsset("avatar-elena") },
  { name: "Jonas", count: 51, src: demoAsset("avatar-jonas") }
];

export const quickTags = [
  { name: "Selezionato", color: "#6D5DFB" },
  { name: "Da montare", color: "#E76F51" },
  { name: "Portfolio", color: "#2A9D8F" },
  { name: "Da rivedere", color: "#D4A373" }
];
