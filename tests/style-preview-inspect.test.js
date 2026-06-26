"use strict";

// Style picker preview inspect smoke suite for Podcast Design Canvas (#157).
// Run with: `node tests/style-preview-inspect.test.js`.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const preview = require("../app/style-preview.js");
const style = require("../app/episode-style.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const ui = fs.readFileSync(path.join(__dirname, "../app/episode-setup.ui.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../app/styles.css"), "utf8");

function visualStructureSignature(look) {
  return [
    look.layoutId,
    look.captionTreatment,
    look.overlayTone,
    look.titleStyle,
    look.captionStyle,
    look.theme.background,
    look.frames.map((frame) => `${frame.role}:${frame.name}`).join(","),
  ].join("|");
}

test("style picker wires a dedicated live preview host beside preset cards", () => {
  assert.ok(ui.includes("style-picker-preview-card"));
  assert.ok(ui.includes("style-picker-live-preview"));
  assert.ok(ui.includes("renderPreview(summary, styleSelection, false)"));
});

test("hero preview nameplates expose speaker role and name from preview frames", () => {
  const look = preview.buildEpisodeLook("split-stage", { showName: "Inspect Show" });
  assert.strictEqual(look.frames[0].role, "Host");
  assert.ok(look.frames[0].name);
  assert.ok(ui.includes('class: "episode-look-role"'));
  assert.ok(ui.includes('class: "episode-look-speaker"'));
});

test("style picker preview CSS enlarges the hero stage for inspection", () => {
  assert.ok(styles.includes("Style picker preview inspect (#157)"));
  const sectionStart = styles.indexOf("Style picker preview inspect (#157)");
  const section = styles.slice(sectionStart, sectionStart + 4200);
  assert.ok(/min-height:\s*420px/.test(section));
  assert.ok(/min-height:\s*228px/.test(section));
  assert.ok(/font-size:\s*14px/.test(section));
});

test("ACCEPTANCE: each preset produces a distinct, legible live preview model", () => {
  const signatures = new Set();
  style.STYLE_PRESETS.forEach((preset) => {
    const look = preview.buildEpisodeLookFromEpisode(
      preset.id,
      preview.sampleEpisodeSummary("Inspect Show"),
      { presetId: preset.id, layout: "auto", pacing: "balanced" },
    );
    assert.ok(look.frames.every((frame) => frame.role && frame.name && frame.initials));
    assert.ok(look.captionText.length > 12);
    assert.ok(look.captionTreatment);
    assert.ok(look.overlayLabel);
    signatures.add(visualStructureSignature(look));
  });
  assert.strictEqual(signatures.size, style.STYLE_PRESETS.length);
});

console.log(`\nstyle preview inspect: ${passed} assertions passed`);
