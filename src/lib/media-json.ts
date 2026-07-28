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
  return {
    ...media,
    bytes: media.bytes.toString(),
    thumbnailUrl: media.thumbnailPath ? `/api/stream/${media.thumbnailPath}` : null,
    previewUrl: media.previewPath ? `/api/stream/${media.previewPath}` : null,
    streamUrl: media.streamPath ? `/api/stream/${media.streamPath}` : null,
    originalUrl: `/api/stream/${media.originalPath}`,
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
