import { prisma } from "@/lib/prisma";

interface StashFile {
  path: string;
}

interface StashPerson {
  id: string;
  name: string;
}

interface StashTag {
  id: string;
  name: string;
}

interface StashScene {
  id: string;
  title: string;
  files: StashFile[];
  performers: StashPerson[];
  tags: StashTag[];
  groups: Array<{ group: { id: string; name: string } }>;
}

interface StashImage {
  id: string;
  title: string;
  files: StashFile[];
  performers: StashPerson[];
  tags: StashTag[];
  galleries: Array<{ id: string; title: string }>;
}

interface StashPage {
  data?: {
    findScenes: { count: number; scenes: StashScene[] };
    findImages: { count: number; images: StashImage[] };
  };
  errors?: Array<{ message: string }>;
}

export interface StashSyncStatus {
  configured: boolean;
  running: boolean;
  scenes: number;
  images: number;
  processed: number;
  matched: number;
  unmatched: number;
  assignments: number;
  people: number;
  tags: number;
  groups: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

const globalSync = globalThis as unknown as {
  frameoStashSync?: StashSyncStatus;
  frameoStashSyncPromise?: Promise<void>;
};

const configured = () =>
  Boolean(process.env.STASH_GRAPHQL_URL && process.env.STASH_API_KEY);

const status =
  globalSync.frameoStashSync ??
  (globalSync.frameoStashSync = {
    configured: configured(),
    running: false,
    scenes: 0,
    images: 0,
    processed: 0,
    matched: 0,
    unmatched: 0,
    assignments: 0,
    people: 0,
    tags: 0,
    groups: 0,
    error: null,
    startedAt: null,
    completedAt: null
  });

const graphql = async (page: number, perPage: number) => {
  const endpoint = process.env.STASH_GRAPHQL_URL;
  const apiKey = process.env.STASH_API_KEY;
  if (!endpoint || !apiKey) throw new Error("Catalogo Stash non configurato");
  const query = `query FrameoCatalog {
    findScenes(filter: { page: ${page}, per_page: ${perPage}, sort: "id", direction: ASC }) {
      count
      scenes {
        id title files { path }
        performers { id name }
        tags { id name }
        groups { group { id name } }
      }
    }
    findImages(filter: { page: ${page}, per_page: ${perPage}, sort: "id", direction: ASC }) {
      count
      images {
        id title files { path }
        performers { id name }
        tags { id name }
        galleries { id title }
      }
    }
  }`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ApiKey: apiKey
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000)
  });
  const payload = await response.json().catch(() => null) as StashPage | null;
  if (!response.ok || !payload?.data) {
    throw new Error(
      payload?.errors?.map(({ message }) => message).join("; ") ||
        `Stash ha risposto con HTTP ${response.status}`
    );
  }
  return payload.data;
};

const frameoPath = (stashPath: string) => {
  const prefix = (process.env.STASH_LIBRARY_PREFIX ?? "/home")
    .replace(/\/+$/, "");
  const relative = stashPath.startsWith(`${prefix}/`)
    ? stashPath.slice(prefix.length + 1)
    : stashPath.replace(/^\/+/, "");
  const root = (process.env.EXTERNAL_MEDIA_STORAGE_PATH ?? "external/library")
    .replace(/^\/+|\/+$/g, "");
  return `${root}/${relative}`.replace(/\\/g, "/");
};

async function ensureTaxonomy(
  people: Set<string>,
  tags: Set<string>,
  groups: Set<string>
) {
  await Promise.all([
    prisma.person.createMany({
      data: [...people].map((name) => ({ name })),
      skipDuplicates: true
    }),
    prisma.tag.createMany({
      data: [...tags].map((name) => ({ name })),
      skipDuplicates: true
    }),
    prisma.group.createMany({
      data: [...groups].map((name) => ({ name })),
      skipDuplicates: true
    })
  ]);
  const [personRows, tagRows, groupRows] = await Promise.all([
    prisma.person.findMany({
      where: { name: { in: [...people] } },
      select: { id: true, name: true }
    }),
    prisma.tag.findMany({
      where: { name: { in: [...tags] } },
      select: { id: true, name: true }
    }),
    prisma.group.findMany({
      where: { name: { in: [...groups] } },
      select: { id: true, name: true }
    })
  ]);
  return {
    people: new Map(personRows.map(({ id, name }) => [name, id])),
    tags: new Map(tagRows.map(({ id, name }) => [name, id])),
    groups: new Map(groupRows.map(({ id, name }) => [name, id]))
  };
}

async function syncPage(scenes: StashScene[], images: StashImage[]) {
  const entries = [
    ...scenes.map((scene) => ({
      title: scene.title,
      files: scene.files,
      people: scene.performers.map(({ name }) => name).filter(Boolean),
      tags: scene.tags.map(({ name }) => name).filter(Boolean),
      groups: scene.groups.map(({ group }) => group.name).filter(Boolean),
      image: false
    })),
    ...images.map((image) => ({
      title: image.title,
      files: image.files,
      people: image.performers.map(({ name }) => name).filter(Boolean),
      tags: image.tags.map(({ name }) => name).filter(Boolean),
      groups: image.galleries.map(({ title }) => title).filter(Boolean),
      image: true
    }))
  ];
  const paths = [...new Set(entries.flatMap(({ files }) => files.map(({ path }) => frameoPath(path))))];
  const media = await prisma.mediaAsset.findMany({
    where: { originalPath: { in: paths } },
    select: { id: true, originalPath: true }
  });
  const mediaByPath = new Map<string, string[]>();
  for (const item of media) {
    mediaByPath.set(item.originalPath, [
      ...(mediaByPath.get(item.originalPath) ?? []),
      item.id
    ]);
  }

  const personNames = new Set(entries.flatMap(({ people }) => people));
  const tagNames = new Set(entries.flatMap(({ tags }) => tags));
  const groupNames = new Set(entries.flatMap(({ groups }) => groups));
  const taxonomy = await ensureTaxonomy(personNames, tagNames, groupNames);
  const mediaPeople: Array<{ mediaId: string; personId: string }> = [];
  const mediaTags: Array<{ mediaId: string; tagId: string }> = [];
  const mediaGroups: Array<{ mediaId: string; groupId: string }> = [];
  const imageReferences = new Map<string, Set<string>>();
  const titleUpdates: Array<{ ids: string[]; title: string }> = [];

  for (const entry of entries) {
    const mediaIds = [...new Set(
      entry.files.flatMap(({ path }) => mediaByPath.get(frameoPath(path)) ?? [])
    )];
    status.processed += 1;
    if (!mediaIds.length) {
      status.unmatched += 1;
      continue;
    }
    status.matched += 1;
    if (entry.title.trim()) titleUpdates.push({ ids: mediaIds, title: entry.title.trim() });
    for (const mediaId of mediaIds) {
      for (const name of entry.people) {
        const personId = taxonomy.people.get(name);
        if (!personId) continue;
        mediaPeople.push({ mediaId, personId });
        if (entry.image) {
          const references = imageReferences.get(personId) ?? new Set<string>();
          if (references.size < 6) references.add(mediaId);
          imageReferences.set(personId, references);
        }
      }
      for (const name of entry.tags) {
        const tagId = taxonomy.tags.get(name);
        if (tagId) mediaTags.push({ mediaId, tagId });
      }
      for (const name of entry.groups) {
        const groupId = taxonomy.groups.get(name);
        if (groupId) mediaGroups.push({ mediaId, groupId });
      }
    }
  }

  if (mediaPeople.length) {
    await prisma.mediaPerson.createMany({
      data: mediaPeople,
      skipDuplicates: true
    });
  }
  if (mediaTags.length) {
    await prisma.mediaTag.createMany({
      data: mediaTags,
      skipDuplicates: true
    });
  }
  if (mediaGroups.length) {
    await prisma.groupMedia.createMany({
      data: mediaGroups,
      skipDuplicates: true
    });
  }
  await Promise.all(
    titleUpdates.map(({ ids, title }) =>
      prisma.mediaAsset.updateMany({
        where: { id: { in: ids } },
        data: { title }
      })
    )
  );
  status.assignments += mediaPeople.length + mediaTags.length + mediaGroups.length;

  for (const [personId, mediaIds] of imageReferences) {
    const existing = await prisma.personReferenceImage.count({ where: { personId } });
    if (existing) continue;
    await prisma.personReferenceImage.createMany({
      data: [...mediaIds].map((mediaId, sortOrder) => ({
        personId,
        mediaId,
        sortOrder
      })),
      skipDuplicates: true
    });
  }
}

async function runSync() {
  const perPage = 200;
  let page = 1;
  let sceneCount = Number.POSITIVE_INFINITY;
  let imageCount = Number.POSITIVE_INFINITY;
  do {
    const data = await graphql(page, perPage);
    sceneCount = data.findScenes.count;
    imageCount = data.findImages.count;
    status.scenes = sceneCount;
    status.images = imageCount;
    await syncPage(data.findScenes.scenes, data.findImages.images);
    page += 1;
  } while (
    (page - 1) * perPage < sceneCount ||
    (page - 1) * perPage < imageCount
  );
  const [people, tags, groups] = await Promise.all([
    prisma.person.count(),
    prisma.tag.count(),
    prisma.group.count()
  ]);
  status.people = people;
  status.tags = tags;
  status.groups = groups;
}

export function getStashSyncStatus(): StashSyncStatus {
  status.configured = configured();
  return { ...status };
}

export function startStashCatalogSync() {
  if (!configured() || status.running) return getStashSyncStatus();
  Object.assign(status, {
    running: true,
    scenes: 0,
    images: 0,
    processed: 0,
    matched: 0,
    unmatched: 0,
    assignments: 0,
    error: null,
    startedAt: new Date().toISOString(),
    completedAt: null
  });
  globalSync.frameoStashSyncPromise = runSync()
    .catch((error) => {
      status.error = error instanceof Error ? error.message : "Sincronizzazione Stash non riuscita";
    })
    .finally(() => {
      status.running = false;
      status.completedAt = new Date().toISOString();
      globalSync.frameoStashSyncPromise = undefined;
    });
  return getStashSyncStatus();
}
