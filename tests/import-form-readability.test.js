"use strict";

// Import form readability smoke suite for Podcast Design Canvas (#155).
// Run with: `node tests/import-form-readability.test.js`.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const setup = require("../app/episode-setup.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const ui = fs.readFileSync(path.join(__dirname, "../app/episode-setup.ui.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../app/styles.css"), "utf8");

test("import form keeps preset-first sections and optional speaker fields", () => {
  assert.ok(ui.includes("setup-section-source"));
  assert.ok(ui.includes("setup-section-preset"));
  assert.ok(ui.includes("f-riversideLink"));
  assert.ok(ui.includes("f-episodeName"));
  assert.ok(ui.includes("speaker-optional-details"));
  assert.ok(ui.includes("speaker-social-group"));
  assert.ok(ui.includes("setupSectionHeader"));
});

test("setup section headers use clearer title hierarchy", () => {
  assert.ok(ui.includes('class: "setup-section-title"'));
  assert.ok(styles.includes(".setup-section-title"));
  assert.ok(styles.includes(".field-hint"));
});

test("ACCEPTANCE: import readability styles improve spacing and helper text legibility", () => {
  assert.ok(styles.includes("Import form readability (#155)"));
  assert.ok(/\.setup-import\s*\{[\s\S]*gap:\s*20px/.test(styles));
  assert.ok(/\.setup-import \.field-hint[\s\S]*line-height:\s*1\.55/.test(styles));
  assert.ok(/\.setup-first-episode-import \.setup-import-head h2[\s\S]*max-width:\s*none/.test(styles));
  const draft = setup.prepareSandboxPresetHandoff(setup.createDraft(), "Readable Show");
  assert.strictEqual(setup.validateDraft(draft).ok, true);
});

console.log(`\nimport form readability: ${passed} assertions passed`);
