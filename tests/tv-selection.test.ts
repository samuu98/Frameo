import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/media/tv-selection/route";
import { prisma } from "../src/lib/prisma";
import { buildMediaWhere } from "../src/lib/media-filters";

test("TV selection validates input, enforces editing/access and saves inclusion and removal", async () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousDemo = process.env.DEMO_MODE;
  const originalUser = prisma.appUser.findFirst;
  const originalFind = prisma.mediaAsset.findMany;
  const originalUpdate = prisma.mediaAsset.updateMany;
  let role = "ADMIN";
  let available = ["a", "b"];
  const updates: Array<{ where: unknown; data: unknown }> = [];
  const user = () => ({ id: "editor", role, active: true, accessRules: role === "CURATOR" ? [{ effect: "DENY", scope: "MEDIA", targetId: "secret" }] : [] });
  Object.assign(prisma.appUser, { findFirst: async () => user() });
  Object.assign(prisma.mediaAsset, {
    findMany: async () => available.map((id) => ({ id })),
    updateMany: async (args: { where: unknown; data: unknown }) => { updates.push(args); return { count: available.length }; }
  });
  const request = (body: unknown) => new Request("http://localhost/api/media/tv-selection", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  try {
    process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
    delete process.env.DEMO_MODE;
    assert.equal((await POST(request({ mediaIds: [], showOnTv: true }))).status, 422);
    assert.equal((await POST(request({ mediaIds: ["a"], showOnTv: "yes" }))).status, 422);
    assert.equal((await POST(request({ mediaIds: Array(501).fill("a"), showOnTv: true }))).status, 422);
    role = "VIEWER";
    assert.equal((await POST(request({ mediaIds: ["a"], showOnTv: true }))).status, 403);
    role = "ADMIN";
    available = ["a"];
    assert.equal((await POST(request({ mediaIds: ["a", "secret"], showOnTv: true }))).status, 404);
    assert.equal(updates.length, 0);
    available = ["a", "b"];
    const response = await POST(request({ mediaIds: ["a", "a", "b"], showOnTv: true }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { mediaIds: ["a", "b"], showOnTv: true });
    assert.deepEqual(updates[0].data, { showOnTv: true });
    role = "CURATOR";
    await POST(request({ mediaIds: ["a", "b"], showOnTv: false }));
    assert.deepEqual(updates[1].data, { showOnTv: false });
    assert.match(JSON.stringify(updates[1].where), /secret/);
    assert.match(JSON.stringify(updates[1].where), /NOT/);
    process.env.DEMO_MODE = "true";
    assert.equal((await (await POST(request({ mediaIds: ["a"], showOnTv: true }))).json()).mode, "demo");
    assert.equal(updates.length, 2);
  } finally {
    Object.assign(prisma.appUser, { findFirst: originalUser });
    Object.assign(prisma.mediaAsset, { findMany: originalFind, updateMany: originalUpdate });
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousDemo === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = previousDemo;
  }
});

test("TV filter adds explicit inclusion while preserving ready, favorites and media kind filters", () => {
  const where = buildMediaWhere(new URL("http://localhost/api/media?tv=true&status=ready&favorite=true&kind=image"), null);
  assert.ok(where.AND.some((entry) => "showOnTv" in entry && entry.showOnTv === true));
  assert.ok(where.AND.some((entry) => "favorite" in entry && entry.favorite === true));
  assert.ok(where.AND.some((entry) => "kind" in entry && entry.kind === "IMAGE"));
  assert.ok(where.AND.some((entry) => "status" in entry));
  assert.equal(buildMediaWhere(new URL("http://localhost/api/media"), null).AND.some((entry) => "showOnTv" in entry), false);
});
