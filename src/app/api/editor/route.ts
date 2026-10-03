import { EditOperation, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildAccessWhere,
  requireEditor
} from "@/lib/access-control";
import { prisma } from "@/lib/prisma";
import { executeEditProject } from "@/lib/video-editor";

export const runtime = "nodejs";

const editorSchema = z.object({
  name: z.string().trim().min(1).max(140),
  operation: z.enum(["TRIM", "SPLIT", "MERGE"]),
  outputFileName: z.string().trim().max(160).optional(),
  segments: z.array(z.object({
    mediaId: z.string().min(1),
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive()
  }).refine((segment) => segment.endMs > segment.startMs, {
    message: "Intervallo clip non valido"
  })).min(1).max(100)
});

export async function POST(request: Request) {
  const parsed = editorSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Progetto di montaggio non valido", issues: parsed.error.issues }, { status: 422 });
  }
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({
      project: {
        id: `edit-${Date.now()}`,
        state: "RUNNING",
        progress: 4,
        ...parsed.data
      },
      mode: "demo"
    }, { status: 202 });
  }
  let user;
  try {
    user = await requireEditor(request);
  } catch {
    return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
  }
  const media = await prisma.mediaAsset.findMany({
    where: {
      AND: [
        buildAccessWhere(user),
        {
          id: { in: parsed.data.segments.map(({ mediaId }) => mediaId) },
          kind: "VIDEO"
        }
      ]
    },
    select: { id: true, durationMs: true }
  });
  if (media.length !== new Set(parsed.data.segments.map(({ mediaId }) => mediaId)).size) {
    return NextResponse.json({ error: "Uno o più video non esistono" }, { status: 404 });
  }
  const durations = new Map(media.map((item) => [item.id, item.durationMs]));
  if (parsed.data.segments.some((segment) => {
    const duration = durations.get(segment.mediaId);
    return duration ? segment.endMs > duration : false;
  })) {
    return NextResponse.json({ error: "Una clip supera la durata della sorgente" }, { status: 422 });
  }

  const project = await prisma.editProject.create({
    data: {
      name: parsed.data.name,
      operation: parsed.data.operation as EditOperation,
      outputFileName: parsed.data.outputFileName,
      createdById: user?.id,
      segments: {
        create: parsed.data.segments.map((segment, sortOrder) => ({
          ...segment,
          sortOrder
        }))
      }
    },
    include: { segments: true }
  });
  void executeEditProject(project.id).catch((error) => {
    console.error(`Edit project ${project.id} failed`, error);
  });
  return NextResponse.json({ project }, { status: 202 });
}

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ projects: [], mode: "demo" });
  }
  let user;
  try {
    user = await requireEditor(request);
  } catch {
    return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
  }
  const projects = await prisma.editProject.findMany({
    where: user.role === UserRole.ADMIN ? {} : { createdById: user.id },
    include: {
      segments: true,
      outputMedia: { select: { id: true, title: true, status: true, thumbnailPath: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  const outputs = await prisma.mediaAsset.findMany({
    where: { AND: [buildAccessWhere(user), { directoryKey: { in: projects.map(({ id }) => `edited/${id}`) } }] },
    select: { id: true, title: true, status: true, directoryKey: true },
    orderBy: { title: "asc" }
  });
  return NextResponse.json({ projects: projects.map((project) => ({
    ...project,
    outputs: outputs.filter((output) => output.directoryKey === `edited/${project.id}`)
  })) });
}
