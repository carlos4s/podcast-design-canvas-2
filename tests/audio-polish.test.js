"use strict";

// Audio polish smoke suite for Podcast Design Canvas (#15).
// Guards quality presets, per-speaker tracks, control adjustments, and review summary.
// Run with: `node tests/audio-polish.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");
const audio = require("../app/audio-polish.js");
const media = require("../app/episode-media.js");

let passed = 0;
function test(name, fn) {
  media.resetStore();
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function polishEpisode(episode, presetId) {
  let polish = audio.createPolish(episode);
  if (presetId) {
    polish = audio.applyPreset(polish, presetId);
  }
  const result = audio.runPolish(polish, episode, media, { episodeKey: "show:ep" });
  assert.strictEqual(result.ok, true, "runPolish should save polished assets for every track");
  return result.polish;
}

function completeUploadDraft() {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Sam Rivera", fileName: "sam.mp4" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Dana Kim", fileName: "dana.mp4" }),
    Object.assign(setup.createSpeaker("Guest 2"), { name: "Marco Vidal", fileName: "marco.mp4" }),
  ];
  return draft;
}

test("offers Natural, Clean, and Studio quality presets", () => {
  assert.strictEqual(audio.QUALITY_PRESETS.length, 3);
  const ids = audio.QUALITY_PRESETS.map((preset) => preset.id);
  assert.deepStrictEqual(ids, ["natural", "clean", "studio"]);
  audio.QUALITY_PRESETS.forEach((preset) => {
    assert.ok(preset.name && preset.tagline, `${preset.id} is described for creators`);
  });
});

test("createPolish seeds speaker tracks from the episode summary", () => {
  const episode = setup.summarize(completeUploadDraft());
  const polish = audio.createPolish(episode);
  assert.strictEqual(polish.presetId, "clean");
  assert.strictEqual(polish.speakers.length, 3);
  assert.deepStrictEqual(polish.speakers.map((track) => track.role), ["Host", "Guest 1", "Guest 2"]);
  assert.strictEqual(polish.speakers[0].sourceLabel, "sam.mp4");
});

test("applyPreset updates all polish controls", () => {
  const episode = setup.summarize(completeUploadDraft());
  let polish = audio.createPolish(episode);
  polish = audio.applyPreset(polish, "studio");
  assert.strictEqual(polish.presetId, "studio");
  assert.strictEqual(polish.noiseCleanup, "strong");
  assert.strictEqual(polish.leveling, "strong");
  assert.strictEqual(polish.speechClarity, "strong");
  assert.strictEqual(polish.enhancement, "strong");
});

test("updateControl changes a single polish dimension", () => {
  const episode = setup.summarize(completeUploadDraft());
  let polish = audio.createPolish(episode);
  polish = audio.updateControl(polish, "noiseCleanup", "light");
  assert.strictEqual(polish.noiseCleanup, "light");
  assert.strictEqual(polish.leveling, "balanced");
});

test("summarizePolish reflects the chosen treatment", () => {
  const episode = setup.summarize(completeUploadDraft());
  const polish = audio.applyPreset(audio.createPolish(episode), "natural");
  const summary = audio.summarizePolish(polish);
  assert.strictEqual(summary.presetName, "Natural");
  assert.strictEqual(summary.noiseCleanupLabel, "Light");
  assert.ok(summary.treatmentLine.includes("Noise cleanup: Light"));
  assert.strictEqual(summary.speakerCount, 3);
});

test("unprocessed polish is not yet ready for export", () => {
  const episode = setup.summarize(completeUploadDraft());
  const summary = audio.summarizePolish(audio.createPolish(episode), media);
  assert.strictEqual(summary.complete, false);
  assert.strictEqual(summary.usesPolishedForExport, false);
  const review = audio.buildReviewSummary(episode, summary, {});
  assert.strictEqual(review.readyForExport, false);
});

test("runPolish saves a distinct polished asset for every imported track", () => {
  const episode = setup.summarize(completeUploadDraft());
  const polish = polishEpisode(episode, "studio");
  assert.strictEqual(polish.status, "complete");
  polish.speakers.forEach((track) => {
    assert.strictEqual(track.status, "complete");
    assert.ok(track.polishedAssetId, "track has a polished asset id");
    assert.ok(media.hasAsset(track.polishedAssetId), "polished asset is saved in the store");
    const polished = media.getAsset(track.polishedAssetId);
    assert.strictEqual(polished.kind, "polished");
    assert.ok(polished.sizeBytes > 44, "polished asset carries real WAV bytes");
    const source = media.getAsset(track.sourceAssetId);
    assert.ok(source, "raw source asset exists");
    assert.notStrictEqual(polished.checksum, source.checksum, "polished bytes differ from raw source");
  });
});

test("buildReviewSummary includes polished audio once processed", () => {
  const episode = setup.summarize(completeUploadDraft());
  const polish = polishEpisode(episode, "clean");
  const summary = audio.summarizePolish(polish, media);
  assert.strictEqual(summary.complete, true);
  assert.strictEqual(summary.usesPolishedForExport, true);
  const review = audio.buildReviewSummary(episode, summary, {
    styleName: "Studio Spotlight",
    templateName: "Founders Unfiltered",
  });
  assert.strictEqual(review.episodeName, "Founders Unfiltered #7");
  assert.strictEqual(review.audioPreset, "Clean");
  assert.strictEqual(review.styleName, "Studio Spotlight");
  assert.strictEqual(review.readyForExport, true);
  assert.ok(review.summaryLines.some((line) => line.indexOf("Audio:") === 0));
});

test("ACCEPTANCE: applying polish turns imported tracks into saved polished audio", () => {
  const draft = completeUploadDraft();
  assert.strictEqual(setup.validateDraft(draft).ok, true);

  const episode = setup.summarize(draft);
  let polish = audio.createPolish(episode);
  assert.strictEqual(polish.speakers.length, episode.speakerCount);

  polish = audio.applyPreset(polish, "clean");
  polish = audio.updateControl(polish, "speechClarity", "strong");
  const result = audio.runPolish(polish, episode, media, { episodeKey: "show:ep" });
  assert.strictEqual(result.ok, true);

  const applied = audio.summarizePolish(result.polish, media);
  assert.strictEqual(applied.presetName, "Clean");
  assert.strictEqual(applied.speechClarityLabel, "Strong");
  assert.strictEqual(applied.complete, true);
  assert.strictEqual(applied.usesPolishedForExport, true);
  assert.strictEqual(applied.tracks.length, episode.speakerCount);
  applied.tracks.forEach((track) => {
    assert.ok(media.hasAsset(track.polishedAssetId), "export uses a saved polished asset");
  });

  const manifest = media.buildExportAudioManifest(applied);
  assert.strictEqual(manifest.usePolished, true);
  assert.strictEqual(manifest.tracks.length, episode.speakerCount);

  const review = audio.buildReviewSummary(episode, applied, {});
  assert.strictEqual(review.readyForExport, true);
  assert.ok(review.audioTreatment.includes("Speech clarity: Strong"));
});

console.log(`\naudio polish: ${passed} assertions passed`);
