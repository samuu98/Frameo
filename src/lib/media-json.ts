import type { Prisma } from "@prisma/client";

type MediaWithRelations = Prisma.MediaAssetGetPayload<{
  include: {
    tags: { include: { tag: true } };
    people: { include: { person: true } };
    groups: { include: { group: true } };
    jobs: true;
    markers: true;
    duplicateSources: true;
    duplicateCandidates: true;
  };
}>;

export function mediaToJson(media: MediaWithRelations) {
  const streamUrl = (storagePath: string) =>
    `/api/stream/${storagePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;

  return {
    ...media,
    bytes: media.bytes.toString(),
    thumbnailUrl: media.thumbnailPath ? streamUrl(media.thumbnailPath) : null,
    previewUrl: media.previewPath ? streamUrl(media.previewPath) : null,
    streamUrl: media.streamPath ? streamUrl(media.streamPath) : null,
    originalUrl: streamUrl(media.originalPath),
    tags: media.tags.map(({ tag }) => tag),
    people: media.people.map(({ person, confidence, region }) => ({
      ...person,
      confidence,
      region
    })),
    groups: media.groups.map(({ group, sortOrder }) => ({
      ...group,
      sortOrder
    })),
    markers: media.markers,
    duplicateCount:
      media.duplicateSources.filter(({ status }) => status === "OPEN").length +
      media.duplicateCandidates.filter(({ status }) => status === "OPEN").length
  };
}
