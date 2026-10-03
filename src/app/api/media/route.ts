import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";
import { ImportState, MediaKind, MediaStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerDuplicateMatches } from "@/lib/duplicate-detector";
import { getRequestUser, requireEditor } from "@/lib/access-control";
import { buildMediaWhere } from "@/lib/media-filters";
import { mediaOrderBy, orderByResolution, parseMediaSort } from "@/lib/media-sort";
import { alternateGalleries } from "@/lib/gallery-order";
import { mediaToJson } from "@/lib/media-json";
import { enqueueMediaProcessing } from "@/lib/media-processor";
import {
  getLibrarySettings,
  resolveStorageFolder
} from "@/lib/library-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const videoMimeByExtension = new Map([
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".mkv", "video/x-matroska"],
  [".webm", "video/webm"],
  [".avi", "video/x-msvideo"],
  [".wmv", "video/x-ms-wmv"],
  [".mpeg", "video/mpeg"],
  [".mpg", "video/mpeg"]
]);

const imageMimeByExtension = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".avif", "image/avif"]
]);

const includeRelations = {
  tags: { include: { tag: true } },
  people: { include: { person: true } },
  groups: { include: { group: true } },
  jobs: true,
  markers: true,
  duplicateSources: true,
  duplicateCandidates: true
} as const;

type DiscoveryItem = Awaited<ReturnType<typeof prisma.mediaAsset.findMany<{
  include: typeof includeRelations;
}>>>[number];

/** Greedy, deterministico: premia prima performer e tag non ancora mostrati. */
function mixForDiscovery(items: DiscoveryItem[]) {
  const remaining = [...items];
  const mixed: DiscoveryItem[] = [];
  const seenPeople = new Set<string>();
  const seenTags = new Set<string>();
  const seenGroups = new Set<string>();
  while (remaining.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index];
      const newPeople = item.people.filter(({ personId }) => !seenPeople.has(personId)).length;
      const newTags = item.tags.filter(({ tagId }) => !seenTags.has(tagId)).length;
      const newGroups = item.groups.filter(({ groupId }) => !seenGroups.has(groupId)).length;
      const score = newPeople * 18 + newTags * 5 + newGroups * 4 +
        (item.favorite ? 3 : 0) + Math.min(item.markers.length, 3) * 1.5 +
        Math.min(item.rating, 5) * 0.5 - index * 0.002;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    mixed.push(next);
    next.people.forEach(({ personId }) => seenPeople.add(personId));
    next.tags.forEach(({ tagId }) => seenTags.add(tagId));
    next.groups.forEach(({ groupId }) => seenGroups.add(groupId));
  }
  return mixed;
}

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ items: [], mode: "demo" });
  }

  const url = new URL(request.url);
  const requestedTake = Number(url.searchParams.get("take") ?? 48);
  const take = Math.max(
    1,
    Math.min(Number.isFinite(requestedTake) ? Math.floor(requestedTake) : 48, 200)
  );
  const requestedPage = Number(url.searchParams.get("page") ?? 1);
  const page = Math.max(
    1,
    Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1
  );
  const requestedSkip = Number(url.searchParams.get("skip"));
  const skip = url.searchParams.has("skip")
    ? Math.max(0, Number.isFinite(requestedSkip) ? Math.floor(requestedSkip) : 0)
    : (page - 1) * take;
  const user = await getRequestUser(request);
  const where = buildMediaWhere(url, user);
  const sort = parseMediaSort(url.searchParams.get("sort"));
  const orderBy = mediaOrderBy(sort);
  const discovery = sort === "smart" && url.searchParams.get("discover") === "true";
  const randomOrder = sort === "random";
  const resolutionOrder = sort === "resolution-asc" || sort === "resolution-desc";
  const randomVideos = url.searchParams.get("randomVideos") === "true";
  const performerHome = url.searchParams.get("performerHome")?.trim();
  const randomSeed =
    url.searchParams.get("seed")?.trim().slice(0, 128) || randomUUID();

  const accessWhere = buildMediaWhere(
    new URL(`${url.origin}${url.pathname}`),
    user
  );

  if (randomVideos || performerHome || randomOrder || resolutionOrder) {
    const [eligible, imageCount, videoCount, uncataloguedCount] =
      await prisma.$transaction([
        prisma.mediaAsset.findMany({
          where: {
            AND: [
              where,
              ...(performerHome || randomVideos ? [{
                kind: MediaKind.VIDEO,
                hideFromRandomHome: false,
                ...(performerHome ? { people: { some: { personId: performerHome } } } : {
                  status: MediaStatus.READY,
                  thumbnailPath: { not: null },
                  previewPath: { not: null }
                })
              }] : [])
            ]
          },
          orderBy,
          select: { id: true, width: true, height: true, groups: { select: { groupId: true, group: { select: { ownerPersonId: true } } } } }
        }),
        prisma.mediaAsset.count({
          where: { AND: [accessWhere, { kind: MediaKind.IMAGE }] }
        }),
        prisma.mediaAsset.count({
          where: { AND: [accessWhere, { kind: MediaKind.VIDEO }] }
        }),
        prisma.mediaAsset.count({
          where: {
            AND: [
              accessWhere,
              {
                people: { none: {} },
                tags: { none: {} },
                groups: { none: {} }
              }
            ]
          }
        })
      ]);
    const ordered = resolutionOrder
      ? orderByResolution(eligible, sort as "resolution-asc" | "resolution-desc")
      : randomOrder || (randomVideos && !performerHome)
        ? eligible.map((item) => ({
            ...item,
            order: createHash("sha256").update(randomSeed).update(item.id).digest("hex")
          })).sort((left, right) => left.order.localeCompare(right.order) || left.id.localeCompare(right.id))
        : performerHome && sort === "smart"
          ? alternateGalleries(eligible, (item) => {
              const personal = item.groups.filter(({ group }) => group.ownerPersonId === performerHome);
              return (personal.length ? personal : item.groups).map(({ groupId }) => groupId);
            })
          : eligible;
    const selectedIds = ordered.slice(skip, skip + take).map(({ id }) => id);
    const selected = selectedIds.length
      ? await prisma.mediaAsset.findMany({
          where: { id: { in: selectedIds } },
          include: includeRelations
        })
      : [];
    const selectedById = new Map(selected.map((item) => [item.id, item]));
    const items = selectedIds
      .map((id) => selectedById.get(id))
      .filter((item): item is DiscoveryItem => Boolean(item));

    return NextResponse.json({
      items: items.map(mediaToJson),
      total: eligible.length,
      page,
      pageSize: take,
      pageCount: Math.max(1, Math.ceil(eligible.length / take)),
      counts: {
        all: imageCount + videoCount,
        image: imageCount,
        video: videoCount,
        uncatalogued: uncataloguedCount
      }
    });
  }

  const discoverySkip = discovery && skip < 500 ? 0 : skip;
  const discoveryTake = discovery
    ? Math.min(600, Math.max(take * 6, skip - discoverySkip + take))
    : take;
  const [candidateItems, total, imageCount, videoCount, uncataloguedCount] = await prisma.$transaction([
    prisma.mediaAsset.findMany({
      where,
      include: includeRelations,
      orderBy,
      take: discoveryTake,
      skip: discoverySkip
    }),
    prisma.mediaAsset.count({ where }),
    prisma.mediaAsset.count({
      where: { AND: [accessWhere, { kind: MediaKind.IMAGE }] }
    }),
    prisma.mediaAsset.count({
      where: { AND: [accessWhere, { kind: MediaKind.VIDEO }] }
    }),
    prisma.mediaAsset.count({
      where: {
        AND: [
          accessWhere,
          {
            people: { none: {} },
            tags: { none: {} },
            groups: { none: {} }
          }
        ]
      }
    })
  ]);
  const items = discovery
    ? mixForDiscovery(candidateItems).slice(skip - discoverySkip, skip - discoverySkip + take)
    : candidateItems;

  return NextResponse.json({
    items: items.map(mediaToJson),
    total,
    page,
    pageSize: take,
    pageCount: Math.max(1, Math.ceil(total / take)),
    counts: {
      all: imageCount + videoCount,
      image: imageCount,
      video: videoCount,
      uncatalogued: uncataloguedCount
    }
  });
}

interface UploadResult {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  absolutePath: string;
  relativePath: string;
  contentHash: string;
}

async function streamUpload(request: Request, id: string): Promise<UploadResult> {
  if (!request.body) throw new Error("Upload body is empty");

  const settings = await getLibrarySettings();
  const uploadRoot = resolveStorageFolder(settings.uploadFolder);
  const uploadDir = path.join(uploadRoot, id);
  await mkdir(uploadDir, { recursive: true });
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 ** 3);

  return new Promise((resolve, reject) => {
    let settled = false;
    let busboyFinished = false;
    let outputFinished = false;
    let bytes = 0;
    let lastReportedAt = 0;
    let progressUpdates = Promise.resolve();
    const hash = createHash("sha256");
    let result: Omit<UploadResult, "bytes" | "contentHash"> | null = null;
    const busboy = Busboy({
      headers: Object.fromEntries(request.headers.entries()),
      limits: { files: 1, fileSize: maxUploadBytes }
    });

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      const reason = error instanceof Error ? error : new Error(String(error));
      void Promise.all([
        rm(uploadDir, { recursive: true, force: true }),
        prisma.importAttempt.updateMany({
          where: { id },
          data: {
            state: ImportState.FAILED,
            error: reason.message.slice(0, 4000),
            uploadedBytes: BigInt(bytes),
            completedAt: new Date()
          }
        })
      ]).finally(() => reject(reason));
    };

    const finish = () => {
      if (settled || !busboyFinished || !outputFinished || !result) return;
      const completed = result;
      settled = true;
      progressUpdates
        .catch(() => undefined)
        .finally(() =>
          resolve({ ...completed, bytes, contentHash: hash.digest("hex") })
        );
    };

    busboy.on("file", (_fieldName, file, info) => {
      const safeName = path.basename(info.filename).replace(/[^\w.\-() ]+/g, "_");
      const fileName = safeName || `${id}.bin`;
      const absolutePath = path.join(uploadDir, fileName);
      const relativePath = path.relative(storageRoot, absolutePath).split(path.sep).join("/");
      const output = createWriteStream(absolutePath, { flags: "wx" });
      result = {
        id,
        fileName,
        mimeType: info.mimeType || "application/octet-stream",
        absolutePath,
        relativePath
      };
      progressUpdates = progressUpdates
        .then(() =>
          prisma.importAttempt.update({
            where: { id },
            data: { fileName, mimeType: info.mimeType || null }
          })
        )
        .then(() => undefined)
        .catch(() => undefined);

      file.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        hash.update(chunk);
        const now = Date.now();
        if (now - lastReportedAt >= 500) {
          lastReportedAt = now;
          const uploadedBytes = BigInt(bytes);
          progressUpdates = progressUpdates
            .then(() =>
              prisma.importAttempt.updateMany({
                where: { id, state: ImportState.UPLOADING },
                data: { uploadedBytes }
              })
            )
            .then(() => undefined)
            .catch(() => undefined);
        }
      });
      file.on("limit", () => {
        fail(new Error(`File exceeds the ${maxUploadBytes} byte limit`));
      });
      file.on("error", (error) => fail(error));
      output.on("error", (error) => fail(error));
      output.on("finish", () => {
        outputFinished = true;
        finish();
      });
      file.pipe(output);
    });

    busboy.on("filesLimit", () => fail(new Error("Only one file is accepted per request")));
    busboy.on("error", (error) => fail(error));
    busboy.on("finish", () => {
      busboyFinished = true;
      if (!result) {
        fail(new Error("No file field was found"));
        return;
      }
      finish();
    });

    const body = Readable.fromWeb(request.body as never);
    body.on("error", (error) => fail(error));
    body.pipe(busboy);
  });
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File mancante" }, { status: 400 });
    }
    const demoIsVideo =
      file.type.startsWith("video/") ||
      videoMimeByExtension.has(
        path.extname(file.name).toLocaleLowerCase("en")
      );
    return NextResponse.json(
      {
        item: {
          id: randomUUID(),
          title: file.name.replace(/\.[^/.]+$/, ""),
          status: "PROCESSING",
          kind: demoIsVideo ? "VIDEO" : "IMAGE",
          bytes: String(file.size)
        },
        mode: "demo"
      },
      { status: 202 }
    );
  }

  let trackedImportId: string | null = null;
  let uploadedDirectory: string | null = null;
  try {
    await requireEditor(request);
    const requestedId = request.headers.get("x-frameo-import-id");
    const importId =
      requestedId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestedId)
        ? requestedId
        : randomUUID();
    const encodedName = request.headers.get("x-frameo-file-name") ?? "";
    let requestedName = "File in preparazione";
    try {
      requestedName = decodeURIComponent(encodedName) || requestedName;
    } catch {
      requestedName = encodedName || requestedName;
    }
    const requestedBytes = Number(request.headers.get("x-frameo-file-size") ?? 0);
    await prisma.importAttempt.create({
      data: {
        id: importId,
        fileName: requestedName.slice(0, 255),
        totalBytes: BigInt(
          Number.isFinite(requestedBytes) && requestedBytes > 0
            ? Math.round(requestedBytes)
            : 0
        )
      }
    });
    trackedImportId = importId;

    const uploaded = await streamUpload(request, importId);
    uploadedDirectory = path.dirname(uploaded.absolutePath);
    const extension = path.extname(uploaded.fileName).toLocaleLowerCase("en");
    const inferredVideoMime = videoMimeByExtension.get(extension);
    const inferredImageMime = imageMimeByExtension.get(extension);
    const isVideo = uploaded.mimeType.startsWith("video/") || Boolean(inferredVideoMime);
    const isImage = uploaded.mimeType.startsWith("image/") || Boolean(inferredImageMime);
    const normalizedMimeType = isVideo
      ? uploaded.mimeType.startsWith("video/")
        ? uploaded.mimeType
        : inferredVideoMime as string
      : isImage
        ? uploaded.mimeType.startsWith("image/")
          ? uploaded.mimeType
          : inferredImageMime as string
        : uploaded.mimeType;
    if (!isVideo && !isImage) {
      await Promise.all([
        rm(path.dirname(uploaded.absolutePath), { recursive: true, force: true }),
        prisma.importAttempt.update({
          where: { id: importId },
          data: {
            state: ImportState.FAILED,
            uploadedBytes: BigInt(uploaded.bytes),
            error: "Formato non supportato",
            completedAt: new Date()
          }
        })
      ]);
      return NextResponse.json(
        { error: "Sono accettati soltanto file immagine o video." },
        { status: 415 }
      );
    }

    const media = await prisma.mediaAsset.create({
      data: {
        id: uploaded.id,
        title: uploaded.fileName.replace(/\.[^/.]+$/, ""),
        kind: isVideo ? MediaKind.VIDEO : MediaKind.IMAGE,
        status: MediaStatus.PROCESSING,
        mimeType: normalizedMimeType,
        bytes: BigInt(uploaded.bytes),
        originalPath: uploaded.relativePath,
        sourceFileName: uploaded.fileName,
        contentHash: uploaded.contentHash,
        directoryKey: (await getLibrarySettings()).uploadFolder
      },
      include: includeRelations
    });
    await prisma.importAttempt.update({
      where: { id: importId },
      data: {
        state: ImportState.PROCESSING,
        progress: 100,
        uploadedBytes: BigInt(uploaded.bytes),
        totalBytes: BigInt(uploaded.bytes),
        mimeType: normalizedMimeType,
        mediaId: media.id,
        error: null
      }
    });

    void registerDuplicateMatches(media.id).catch((error) => {
      console.error(`Exact duplicate scan failed for media ${media.id}`, error);
    });
    void enqueueMediaProcessing(media.id).catch((error) => {
      console.error(`Processing failed for media ${media.id}`, error);
    });

    return NextResponse.json({ item: mediaToJson(media) }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_REQUIRED") {
      return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Upload non riuscito";
    await Promise.all([
      trackedImportId
        ? prisma.importAttempt.updateMany({
            where: { id: trackedImportId },
            data: {
              state: ImportState.FAILED,
              error: message.slice(0, 4000),
              completedAt: new Date()
            }
          })
        : Promise.resolve(),
      uploadedDirectory
        ? rm(uploadedDirectory, { recursive: true, force: true })
        : Promise.resolve()
    ]).catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
