import {
  MediaKind,
  MediaStatus,
  type Prisma
} from "@prisma/client";
import { buildAccessWhere, type RequestUser } from "@/lib/access-control";

const csv = (value: string | null) =>
  value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];

const finiteNumber = (value: string | null) => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function buildMediaWhere(url: URL, user: RequestUser | null) {
  const kind = url.searchParams.get("kind");
  const statuses = csv(url.searchParams.get("status"))
    .map((status) => status.toUpperCase())
    .filter((status): status is MediaStatus =>
      Object.values(MediaStatus).includes(status as MediaStatus)
    );
  const people = csv(url.searchParams.get("people"));
  const tags = csv(url.searchParams.get("tags"));
  const groups = csv(url.searchParams.get("groups"));
  const search = url.searchParams.get("search")?.trim();
  const durationMin = finiteNumber(url.searchParams.get("durationMin"));
  const durationMax = finiteNumber(url.searchParams.get("durationMax"));
  const sizeMin = finiteNumber(url.searchParams.get("sizeMin"));
  const sizeMax = finiteNumber(url.searchParams.get("sizeMax"));
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const resolution = url.searchParams.get("resolution");
  const markerOnly = url.searchParams.get("markerOnly") === "true";
  const duplicateOnly = url.searchParams.get("duplicateOnly") === "true";
  const favorite = url.searchParams.get("favorite");
  const uncatalogued = url.searchParams.get("uncatalogued") === "true";

  const filters: Prisma.MediaAssetWhereInput[] = [buildAccessWhere(user)];
  if (kind === "video") filters.push({ kind: MediaKind.VIDEO });
  if (kind === "image") filters.push({ kind: MediaKind.IMAGE });
  if (statuses.length) filters.push({ status: { in: statuses } });
  if (favorite === "true") filters.push({ favorite: true });
  if (favorite === "false") filters.push({ favorite: false });
  if (uncatalogued) {
    filters.push({
      OR: [
        { tags: { none: {} } },
        { status: { in: [MediaStatus.UPLOADING, MediaStatus.PROCESSING] } }
      ]
    });
  }

  if (search) {
    filters.push({
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { sourceFileName: { contains: search, mode: "insensitive" } }
      ]
    });
  }
  if (people.length) {
    filters.push({ people: { some: { person: { name: { in: people } } } } });
  }
  if (tags.length) {
    filters.push({ tags: { some: { tag: { name: { in: tags } } } } });
  }
  if (groups.length) {
    filters.push({ groups: { some: { group: { name: { in: groups } } } } });
  }
  if (durationMin !== null || durationMax !== null) {
    filters.push({
      durationMs: {
        ...(durationMin !== null ? { gte: Math.round(durationMin * 1000) } : {}),
        ...(durationMax !== null ? { lte: Math.round(durationMax * 1000) } : {})
      }
    });
  }
  if (sizeMin !== null || sizeMax !== null) {
    filters.push({
      bytes: {
        ...(sizeMin !== null ? { gte: BigInt(Math.round(sizeMin)) } : {}),
        ...(sizeMax !== null ? { lte: BigInt(Math.round(sizeMax)) } : {})
      }
    });
  }
  if (dateFrom || dateTo) {
    filters.push({
      createdAt: {
        ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {})
      }
    });
  }
  if (resolution === "4k") filters.push({ width: { gte: 3840 } });
  if (resolution === "hd") {
    filters.push({ width: { gte: 1280, lt: 3840 } });
  }
  if (resolution === "sd") filters.push({ width: { lt: 1280 } });
  if (markerOnly) filters.push({ markers: { some: { featured: true } } });
  if (duplicateOnly) {
    filters.push({
      OR: [
        { duplicateSources: { some: { status: "OPEN" } } },
        { duplicateCandidates: { some: { status: "OPEN" } } }
      ]
    });
  }

  return { AND: filters } satisfies Prisma.MediaAssetWhereInput;
}
