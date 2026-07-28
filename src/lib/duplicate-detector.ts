import path from "node:path";
import sharp from "sharp";
import { DuplicateStatus, MediaKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function calculatePerceptualHash(imagePath: string) {
  const { data } = await sharp(imagePath, { failOn: "none" })
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const left = data[row * 9 + column];
      const right = data[row * 9 + column + 1];
      bits += left > right ? "1" : "0";
    }
  }

  return Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(bits.slice(index * 4, index * 4 + 4), 2).toString(16)
  ).join("");
}

const bitCount = (value: number) => {
  let current = value;
  let count = 0;
  while (current) {
    count += current & 1;
    current >>>= 1;
  }
  return count;
};

export function perceptualSimilarity(first: string, second: string) {
  if (first.length !== second.length || first.length !== 16) return 0;
  let distance = 0;
  for (let index = 0; index < first.length; index += 2) {
    const a = Number.parseInt(first.slice(index, index + 2), 16);
    const b = Number.parseInt(second.slice(index, index + 2), 16);
    distance += bitCount(a ^ b);
  }
  return 1 - distance / 64;
}

const orderedPair = (first: string, second: string) =>
  first.localeCompare(second) < 0
    ? { sourceMediaId: first, candidateMediaId: second }
    : { sourceMediaId: second, candidateMediaId: first };

export async function registerDuplicateMatches(mediaId: string) {
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!media) return [];

  const candidates = await prisma.mediaAsset.findMany({
    where: {
      id: { not: media.id },
      kind: media.kind,
      OR: [
        ...(media.contentHash ? [{ contentHash: media.contentHash }] : []),
        ...(media.perceptualHash ? [{ perceptualHash: { not: null } }] : [])
      ]
    },
    select: {
      id: true,
      contentHash: true,
      perceptualHash: true
    }
  });

  const created = [];
  for (const candidate of candidates) {
    const exact =
      Boolean(media.contentHash) &&
      media.contentHash === candidate.contentHash;
    const similarity =
      exact || !media.perceptualHash || !candidate.perceptualHash
        ? exact
          ? 1
          : 0
        : perceptualSimilarity(media.perceptualHash, candidate.perceptualHash);

    if (!exact && similarity < 0.88) continue;
    const pair = orderedPair(media.id, candidate.id);
    created.push(
      await prisma.duplicateMatch.upsert({
        where: {
          sourceMediaId_candidateMediaId: pair
        },
        update: {
          similarity,
          reason: exact
            ? "SHA-256 identico"
            : media.kind === MediaKind.IMAGE
              ? "Immagine visivamente simile"
              : "Fotogramma video visivamente simile",
          status: DuplicateStatus.OPEN
        },
        create: {
          ...pair,
          similarity,
          reason: exact
            ? "SHA-256 identico"
            : media.kind === MediaKind.IMAGE
              ? "Immagine visivamente simile"
              : "Fotogramma video visivamente simile"
        }
      })
    );
  }
  return created;
}

export async function refreshPerceptualHash(mediaId: string, imagePath: string) {
  const perceptualHash = await calculatePerceptualHash(path.resolve(imagePath));
  await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: { perceptualHash }
  });
  return registerDuplicateMatches(mediaId);
}
