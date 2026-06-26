// Running-product acceptance for locked canvas layers (#190).
// Run: node tests/browser-canvas-layer-lock.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8768;

function mime(path) {
  const ext = extname(path);
  if (ext === ".html") return "text/html";
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  return "application/octet-stream";
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const rel = req.url === "/" ? "/index.html" : req.url.split("?")[0];
      const file = join(root, rel.replace(/^\//, ""));
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": mime(file) });
      res.end(readFileSync(file));
    });
    server.listen(port, () => resolve(server));
  });
}

async function completeSetup(page) {
  await page.getByRole("button", { name: "Start blank episode" }).click();
  await page.waitForSelector("form.setup-import");
  await page.locator("#f-episodeName").fill("Founders Unfiltered #7");
  await page.locator("#f-riversideLink").fill("https://riverside.fm/studio/founders-ep1");
  await page.locator("#f-sp-0-name").fill("Sam Rivera");
  await page.locator("#f-sp-1-name").fill("Dana Kim");
  await page.locator("#f-sp-2-name").fill("Alex Chen");
  await page.locator(".setup-preset-card").first().click();
  await page.locator(".guided-workspace").waitFor({ state: "visible" });
}

async function openCanvasFromPrimaryNext(page) {
  const primary = page.locator("#workspace-primary-next");
  await primary.waitFor({ state: "visible" });
  const label = (await primary.textContent()) || "";
  if (!/open canvas editor/i.test(label)) {
    throw new Error(`Expected primary next to open canvas editor, got: ${label.trim()}`);
  }
  await primary.click();
  await page.locator(".canvas-step").waitFor({ state: "visible" });
}

async function readBounds(locator) {
  return locator.evaluate((el) => ({
    left: el.style.left,
    top: el.style.top,
    width: el.style.width,
    height: el.style.height,
  }));
}

async function layerStackLabels(page) {
  return page.locator(".canvas-layer .canvas-layer-name").allTextContents();
}

async function pointerDrag(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Missing bounding box for drag target");
  }
  const startX = box.x + Math.max(12, box.width / 4);
  const startY = box.y + Math.max(12, box.height / 4);
  const endX = startX + dx;
  const endY = startY + dy;
  await locator.dispatchEvent("pointerdown", {
    clientX: startX,
    clientY: startY,
    pointerId: 1,
    bubbles: true,
    cancelable: true,
  });
  await locator.dispatchEvent("pointermove", {
    clientX: endX,
    clientY: endY,
    pointerId: 1,
    bubbles: true,
    cancelable: true,
  });
  await locator.dispatchEvent("pointerup", {
    clientX: endX,
    clientY: endY,
    pointerId: 1,
    bubbles: true,
    cancelable: true,
  });
  await page.waitForTimeout(100);
}

async function pointerResize(page, stageLocator, dx, dy) {
  const handle = stageLocator.locator(".canvas-obj-resize-handle");
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error("Missing resize handle bounding box");
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = startX + dx;
  const endY = startY + dy;
  await handle.dispatchEvent("pointerdown", {
    clientX: startX,
    clientY: startY,
    pointerId: 1,
    bubbles: true,
    cancelable: true,
  });
  await handle.dispatchEvent("pointermove", {
    clientX: endX,
    clientY: endY,
    pointerId: 1,
    bubbles: true,
    cancelable: true,
  });
  await handle.dispatchEvent("pointerup", {
    clientX: endX,
    clientY: endY,
    pointerId: 1,
    bubbles: true,
    cancelable: true,
  });
  await page.waitForTimeout(100);
}

async function main() {
  const server = await startServer();
  let browser;
  let failed = false;
  const log = (ok, msg) => {
    console.log(`${ok ? "  ok" : " FAIL"} ${msg}`);
    if (!ok) failed = true;
  };

  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });

    await completeSetup(page);
    log(await page.locator(".guided-workspace").isVisible(), "Setup lands in production workspace");

    await openCanvasFromPrimaryNext(page);
    log(await page.locator(".canvas-step").isVisible(), "ACCEPTANCE: workspace primary next opens the canvas editor");
    log(await page.getByRole("heading", { name: /Customize/i }).isVisible(), "Canvas editor headline is visible");
    await page.screenshot({ path: join(root, "tests", "canvas-layer-lock-editor.png"), fullPage: false });
    log(true, "Screenshot saved to tests/canvas-layer-lock-editor.png");

    const titleRow = page.locator(".canvas-layer").filter({ hasText: "Title moment" });
    const titleStage = page.locator(".canvas-obj-title");
    const lowerThirdRow = page.locator(".canvas-layer").filter({ hasText: "Lower-third" });
    const brandRow = page.locator(".canvas-layer").filter({ hasText: "Logo / show branding" });

    await titleRow.getByRole("button", { name: "Lock" }).click();
    await titleRow.locator(".canvas-layer-meta", { hasText: "position locked" }).waitFor();
    log(await titleRow.evaluate((el) => el.classList.contains("is-locked")), "Locked title row shows is-locked");
    log(await titleStage.evaluate((el) => el.classList.contains("is-locked")), "Locked title stage object shows is-locked");
    await page.screenshot({ path: join(root, "tests", "canvas-layer-lock-locked.png"), fullPage: false });
    log(true, "Screenshot saved to tests/canvas-layer-lock-locked.png");

    const moveUp = titleRow.locator("button", { hasText: "▲" });
    const moveDown = titleRow.locator("button", { hasText: "▼" });
    log(await moveUp.isDisabled(), "Locked layer reorder up is disabled");
    log(await moveDown.isDisabled(), "Locked layer reorder down is disabled");
    log(await lowerThirdRow.locator("button", { hasText: "▼" }).isDisabled(), "Neighbor cannot reorder into locked title");

    const stackBeforeAdd = await layerStackLabels(page);
    const titleIndexBefore = stackBeforeAdd.indexOf("Title moment");
    await page.getByRole("button", { name: "Add layer" }).click();
    await page.waitForTimeout(100);
    const stackAfterAdd = await layerStackLabels(page);
    log(stackAfterAdd[titleIndexBefore] === "Title moment", "Add layer does not displace locked title stack slot");
    log(stackAfterAdd.length === stackBeforeAdd.length + 1, "Add layer appends without shifting locked indices");

    log(await lowerThirdRow.getByRole("button", { name: "Remove" }).isDisabled(), "Remove above locked title is blocked (displacement)");

    log(await titleStage.locator(".canvas-obj-resize-handle").count() === 0, "Locked layer hides resize handle on stage");
    log(await brandRow.locator("button", { hasText: "▲" }).isDisabled(), "Default locked brand cannot reorder up");

    const lockedBounds = await readBounds(titleStage);
    await pointerDrag(page, titleStage, 90, 60);
    const afterLockedDrag = await readBounds(titleStage);
    log(
      lockedBounds.left === afterLockedDrag.left
        && lockedBounds.top === afterLockedDrag.top
        && lockedBounds.width === afterLockedDrag.width
        && lockedBounds.height === afterLockedDrag.height,
      "Locked layer drag does not change bounds",
    );

    await titleRow.getByRole("button", { name: "Unlock" }).click();
    await titleRow.getByRole("button", { name: "Lock" }).waitFor();
    log(!(await titleRow.evaluate((el) => el.classList.contains("is-locked"))), "Unlock restores editable layer row");
    log(await titleStage.locator(".canvas-obj-resize-handle").count() === 1, "Unlocked layer shows resize handle");

    const unlockedBefore = await readBounds(titleStage);
    await pointerDrag(page, titleStage, 50, 30);
    const afterUnlockedDrag = await readBounds(titleStage);
    log(
      unlockedBefore.left !== afterUnlockedDrag.left || unlockedBefore.top !== afterUnlockedDrag.top,
      "Unlocked layer drag changes bounds",
    );

    const beforeResize = await readBounds(titleStage);
    await pointerResize(page, titleStage, 40, 25);
    const afterResize = await readBounds(titleStage);
    log(
      beforeResize.width !== afterResize.width || beforeResize.height !== afterResize.height,
      "Unlocked layer resize changes bounds",
    );

    const stackBeforeMove = await layerStackLabels(page);
    await titleRow.locator("button", { hasText: "▲" }).click();
    await page.waitForTimeout(100);
    const stackAfterMove = await layerStackLabels(page);
    log(
      stackBeforeMove.indexOf("Title moment") !== stackAfterMove.indexOf("Title moment"),
      "Unlocked layer reorder changes stack order",
    );

    await page.screenshot({ path: join(root, "tests", "canvas-layer-lock-unlocked.png"), fullPage: false });
    log(true, "Screenshot saved to tests/canvas-layer-lock-unlocked.png");
  } catch (err) {
    console.error(err);
    failed = true;
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  if (failed) {
    process.exit(1);
  }
  console.log("\nBrowser canvas layer lock: all checks passed.");
}

main();
