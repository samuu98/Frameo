import { randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import path from "node:path";
import {
  FileOperationKind,
  JobState,
  type AppUser
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const safeSegment = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}_\- ]+/gu, "_")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 90) || "senza-nome";

const assertInsideStorage = (target: string) => {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error("Path outside managed storage");
  }
  return resolved;
};

const pathExists = async (target: string) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

export interface OrganizationPlanItem {
  mediaId: string;
  title: string;
  sourcePath: string;
  targetPath: string;
  sourceAbsolute: string;
  targetAbsolute: string;
}

export async function buildOrganizationPlan(mediaIds: string[], personName: string) {
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: mediaIds } },
    select: {
      id: true,
      title: true,
      originalPath: true,
      sourceFileName: true
    }
  });
  const personFolder = safeSegment(personName);
  const targetDirectory = assertInsideStorage(
    path.join(storageRoot, "organized", "people", personFolder)
  );
  const reserved = new Set<string>();
  const plan: OrganizationPlanItem[] = [];

  for (const asset of assets) {
    const sourceAbsolute = assertInsideStorage(path.join(storageRoot, asset.originalPath));
    const extension = path.extname(asset.sourceFileName ?? asset.originalPath);
    const baseName = safeSegment(asset.title);
    let fileName = `${baseName}${extension}`;
    let index = 2;
    let targetAbsolute = assertInsideStorage(path.join(targetDirectory, fileName));
    while (
      reserved.has(fileName.toLowerCase()) ||
      (targetAbsolute !== sourceAbsolute && await pathExists(targetAbsolute))
    ) {
      fileName = `${baseName}-${index}${extension}`;
      index += 1;
      targetAbsolute = assertInsideStorage(path.join(targetDirectory, fileName));
    }
    reserved.add(fileName.toLowerCase());
    plan.push({
      mediaId: asset.id,
      title: asset.title,
      sourcePath: asset.originalPath,
      targetPath: path.relative(storageRoot, targetAbsolute).split(path.sep).join("/"),
      sourceAbsolute,
      targetAbsolute
    });
  }
  return plan;
}

const moveFile = async (source: string, target: string) => {
  try {
    await rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(source, target);
    await unlink(source);
  }
};

export async function executeOrganizationPlan(
  plan: OrganizationPlanItem[],
  kind: FileOperationKind,
  user: AppUser | null
) {
  const operationIds: string[] = [];
  for (const item of plan) {
    await stat(item.sourceAbsolute);
    await mkdir(path.dirname(item.targetAbsolute), { recursive: true });
    const operation = await prisma.fileOperation.create({
      data: {
        id: randomUUID(),
        kind,
        state: JobState.RUNNING,
        mediaId: item.mediaId,
        sourcePath: item.sourcePath,
        targetPath: item.targetPath,
        removeOriginal: kind === FileOperationKind.MOVE,
        confirmedAt: new Date(),
        createdById: user?.id
      }
    });
    operationIds.push(operation.id);
    try {
      if (kind === FileOperationKind.MOVE) {
        await moveFile(item.sourceAbsolute, item.targetAbsolute);
        try {
          await prisma.mediaAsset.update({
            where: { id: item.mediaId },
            data: {
              originalPath: item.targetPath,
              sourceFileName: path.basename(item.targetPath),
              directoryKey: path.dirname(item.targetPath).split(path.sep).join("/")
            }
          });
        } catch (error) {
          await moveFile(item.targetAbsolute, item.sourceAbsolute).catch(() => undefined);
          throw error;
        }
      } else {
        await copyFile(item.sourceAbsolute, item.targetAbsolute);
      }
      await prisma.fileOperation.update({
        where: { id: operation.id },
        data: { state: JobState.COMPLETED, endedAt: new Date() }
      });
    } catch (error) {
      await prisma.fileOperation.update({
        where: { id: operation.id },
        data: {
          state: JobState.FAILED,
          endedAt: new Date(),
          error: error instanceof Error ? error.message.slice(0, 4000) : "File operation failed"
        }
      });
      throw error;
    }
  }
  return operationIds;
}

export async function renameManagedFile(mediaId: string, requestedName: string) {
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!media) throw new Error("Media not found");
  const source = assertInsideStorage(path.join(storageRoot, media.originalPath));
  const extension = path.extname(media.sourceFileName ?? media.originalPath);
  const baseName = safeSegment(requestedName);
  let newFileName = `${baseName}${extension}`;
  let target = assertInsideStorage(path.join(path.dirname(source), newFileName));
  let index = 2;
  while (target !== source && await pathExists(target)) {
    newFileName = `${baseName}-${index}${extension}`;
    target = assertInsideStorage(path.join(path.dirname(source), newFileName));
    index += 1;
  }
  if (source !== target) await moveFile(source, target);
  try {
    return await prisma.mediaAsset.update({
      where: { id: mediaId },
      data: {
        title: requestedName.trim(),
        sourceFileName: newFileName,
        originalPath: path.relative(storageRoot, target).split(path.sep).join("/")
      }
    });
  } catch (error) {
    if (source !== target) await moveFile(target, source).catch(() => undefined);
    throw error;
  }
}
