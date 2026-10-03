// Run against a development server: FRAMEO_TEST_URL=http://localhost:3102 node tests/tv-gallery.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const fixtureDirectory = mkdtempSync(path.join(tmpdir(), "frameo-tv-test-"));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  const queries = [];
  let fail = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/media?*", (route) => {
    assert.equal(route.request().method(), "GET");
    const params = new URL(route.request().url()).searchParams;
    queries.push(params);
    assert.equal(params.get("tv"), "true");
    if (fail) return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    const offset = (Number(params.get("page")) - 1) * 24;
    const empty = params.get("kind") === "video";
    return route.fulfill({ json: { total: empty ? 0 : 25, items: empty ? [] : Array.from({ length: offset ? 1 : 24 }, (_, index) => ({
      id: `image-${offset + index}`, title: `Foto ${offset + index}`, kind: "IMAGE", thumbnailUrl: "/demo/coast.svg",
      originalUrl: "/demo/coast.svg", streamUrl: null, durationMs: null, favorite: true
    })) } });
  });
  await page.route("**/api/media/*/display?*", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#71879d"/></svg>' }));
  await page.goto(`${process.env.FRAMEO_TEST_URL ?? "http://localhost:3102"}/tv`);
  await page.locator("[data-tv-card]").first().waitFor();
  assert.equal(await page.locator("[data-tv-card]").count(), 24);
  await page.locator("[data-tv-card]").first().focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Foto: Foto 1");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Foto: Foto 5");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Successivo →", exact: true }).click();
  assert.equal(await page.getByRole("dialog").getAttribute("aria-label"), "Foto 6");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Foto: Foto 5");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.goBack();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Pagina successiva →", exact: true }).click();
  await page.getByRole("button", { name: "Foto: Foto 24", exact: true }).waitFor();
  assert.equal(await page.locator("[data-tv-card]").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Pagina successiva →", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await page.getByText("Nessun contenuto disponibile con questo filtro.").waitFor();
  assert.equal(queries.at(-1).get("page"), "1");
  assert.equal(queries.at(-1).get("status"), "ready");
  fail = true;
  await page.getByRole("button", { name: "Preferiti", exact: true }).click();
  await page.locator(".tv-message[role=alert]").waitFor();
  fail = false;
  await page.getByRole("button", { name: "Riprova", exact: true }).click();
  await page.locator("[data-tv-card]").first().waitFor();
  assert.equal(queries.at(-1).get("favorite"), "true");
  await page.setViewportSize({ width: 800, height: 600 });
  await page.locator("[data-tv-card]").first().focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Foto: Foto 3");
  // Exercise actual playback and seek with a small local H.264/AAC fixture.
  const fixturePath = path.join(fixtureDirectory, "video.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", fixturePath]);
  await page.route("**/api/media?*", (route) => route.fulfill({ json: { total: 1, items: [{
    id: "video-test", title: "Video test", kind: "VIDEO", thumbnailUrl: "/demo/coast.svg",
    originalUrl: "/unsupported.mkv", streamUrl: "/playlist.m3u8", favorite: false, durationMs: 20000
  }] } }));
  await page.route("**/api/media/video-test/compatible", (route) => {
    assert.equal(route.request().method(), "GET");
    return route.fulfill({ json: { state: "ready", url: "/tv-fixture.mp4" } });
  });
  await page.route("**/unsupported.mkv", (route) => route.fulfill({ status: 404 }));
  await page.route("**/tv-fixture.mp4", (route) => route.fulfill({ contentType: "video/mp4", body: readFileSync(fixturePath) }));
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await page.getByRole("button", { name: "Video: Video test", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  assert.equal(await page.locator("video").getAttribute("src"), "/tv-fixture.mp4");
  await page.getByRole("button", { name: "Riproduci", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("video")?.paused === false);
  await page.getByRole("button", { name: "+10 s", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("video")?.currentTime >= 10);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "MediaPlayPause", keyCode: 179, bubbles: true })));
  await page.waitForFunction(() => document.querySelector("video")?.paused === true);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 4, bubbles: true })));
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: "/tmp/frameo-tv-gallery.png" });
  console.log("TV gallery: navigation, history/focus, pagination, filters, retry, responsive grid, compatible MP4 playback, seek and remote keys passed.");
} finally {
  await browser.close();
  rmSync(fixtureDirectory, { recursive: true, force: true });
}
