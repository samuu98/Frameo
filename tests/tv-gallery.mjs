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
    assert.equal(params.get("sort"), "random");
    assert.ok(params.get("seed"));
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
  const firstSeed = queries.at(-1).get("seed");
  await page.locator("[data-tv-card]").first().focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Foto: Foto 1");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Foto: Foto 4");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Successivo →", exact: true }).click();
  assert.equal(await page.getByRole("dialog").getAttribute("aria-label"), "Foto 5");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Foto: Foto 4");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.goBack();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  fail = true;
  await page.locator(".tv-load-more").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Riprova caricamento", exact: true }).waitFor();
  assert.equal(await page.locator("[data-tv-card]").count(), 24);
  fail = false;
  await page.getByRole("button", { name: "Riprova caricamento", exact: true }).click();
  await page.getByRole("button", { name: "Foto: Foto 24", exact: true }).waitFor();
  assert.equal(await page.locator("[data-tv-card]").count(), 25);
  assert.equal(await page.getByRole("button", { name: /Pagina/ }).count(), 0);
  await page.getByRole("button", { name: "Tutti", exact: true }).click();
  assert.equal(await page.locator("[data-tv-card]").count(), 25);
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
  assert.ok(queries.every((query) => query.get("seed") === firstSeed));
  await page.reload();
  await page.locator("[data-tv-card]").first().waitFor();
  assert.notEqual(queries.at(-1).get("seed"), firstSeed);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.locator("[data-tv-card]").first().focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Foto: Foto 2");
  // Exercise actual playback and seek with a small local H.264/AAC fixture.
  const fixturePath = path.join(fixtureDirectory, "video.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=90x160:r=10", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", fixturePath]);
  await page.route("**/api/media?*", (route) => route.fulfill({ json: { total: 1, items: [{
    id: "video-test", title: "Video test", kind: "VIDEO", thumbnailUrl: "/demo/coast.svg",
    previewUrl: "/tv-fixture.mp4", originalUrl: "/unsupported.mkv", streamUrl: "/playlist.m3u8", favorite: false, durationMs: 20000
  }] } }));
  await page.route("**/api/media/video-test/compatible", (route) => {
    assert.equal(route.request().method(), "GET");
    return route.fulfill({ json: { state: "ready", url: "/tv-fixture.mp4" } });
  });
  await page.route("**/unsupported.mkv", (route) => route.fulfill({ status: 404 }));
  await page.route("**/tv-fixture.mp4", (route) => {
    const data = readFileSync(fixturePath);
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : data.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: "video/mp4",
      headers: { "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), ...(range ? { "Content-Range": `bytes ${start}-${end}/${data.length}` } : {}) },
      body: data.subarray(start, end + 1) });
  });
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.tv-thumbnail video')?.paused === false);
  assert.equal(await page.locator('.tv-thumbnail video').evaluate((video) => video.muted && video.loop), true);
  assert.equal(await page.locator('.tv-thumbnail video').evaluate((video) => getComputedStyle(video).objectFit), 'contain');
  assert.equal(await page.locator('.tv-thumbnail img').evaluate((image) => getComputedStyle(image).objectFit), 'contain');
  assert.equal(await page.locator('.tv-thumbnail video').evaluate((video) => video.videoWidth / video.videoHeight), 90 / 160);
  await page.getByRole("button", { name: "Video: Video test", exact: true }).click();
  assert.equal(await page.locator('.tv-thumbnail video').count(), 0);
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  assert.equal(await page.locator("video").getAttribute("src"), "/tv-fixture.mp4");
  await page.getByRole("button", { name: "Riproduci", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("video")?.paused === false);
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('tv-viewer'));
  await page.getByRole("button", { name: "+10 s", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("video")?.currentTime >= 10);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "MediaPlayPause", keyCode: 179, bubbles: true })));
  await page.waitForFunction(() => document.querySelector("video")?.paused === true);
  const timeline = page.getByRole("slider", { name: "Posizione di riproduzione" });
  await timeline.focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.querySelector(".tv-stage video")?.currentTime < .2 && !document.querySelector(".tv-stage video")?.seeking);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelector(".tv-stage video")?.currentTime >= 10);
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => document.querySelector(".tv-stage video")?.currentTime < .2 && !document.querySelector(".tv-stage video")?.seeking);
  await page.getByRole("button", { name: "−10 s", exact: true }).click();
  assert.equal(await page.locator(".tv-stage video").evaluate(video => video.currentTime), 0);
  await page.getByRole("button", { name: "Disattiva audio", exact: true }).click();
  assert.equal(await page.locator(".tv-stage video").evaluate(video => video.muted), true);
  await page.getByRole("button", { name: "Velocità 1×", exact: true }).click();
  assert.equal(await page.locator(".tv-stage video").evaluate(video => video.playbackRate), 1.25);
  await page.getByRole("button", { name: "Riproduci", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".tv-viewer")?.classList.contains("controls-hidden"));
  const beforeSeek = await page.locator(".tv-stage video").evaluate(video => video.currentTime);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => !document.querySelector(".tv-viewer")?.classList.contains("controls-hidden"));
  assert.ok(await page.locator(".tv-stage video").evaluate(video => video.currentTime) >= beforeSeek + 9);
  await page.getByRole("button", { name: "Pausa", exact: true }).click();
  await page.screenshot({ path: "/tmp/frameo-tv-player.png" });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 4, bubbles: true })));
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.fullscreenElement === null);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: "/tmp/frameo-tv-gallery.png" });
  console.log("TV gallery: continuous loading/retry, navigation, preview playback, fullscreen, timeline and remote seek, audio/speed, auto-hide, filters and responsive grid passed.");
} finally {
  await browser.close();
  rmSync(fixtureDirectory, { recursive: true, force: true });
}
