"use strict";

// Audio polish processing smoke suite for Podcast Design Canvas (#197).
// Run with: `node tests/audio-polish-processing.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");
const audio = require("../app/audio-polish.js");
const media = require("../app/episode-media.js");
const exportModel = require("../app/episode-export.js");
const review = require("../app/publish-review.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const EPISODE_KEY = "show-test:ep-test";

function uploadEpisode() {
  const draft = setup.createDraft();
  draft.episodeName = "Indie Makers Weekly — Episode 3";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Jordan Lee", fileName: "jordan-synced.mp4" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Priya Shah", fileName: "priya-synced.mp4" }),
    Object.assign(setup.createSpeaker("Guest 2"), { name: "Chris Ortiz", fileName: "chris-synced.mp4" }),
  ];
  return setup.summarize(draft);
}

function riversideEpisode() {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered — Episode 1";
  draft.riversideLink = "https://riverside.fm/studio/founders-ep1";
  draft.speakers.forEach((speaker, index) => {
    speaker.name = ["Sam Rivera", "Dana Kim", "Alex Chen"][index];
  });
  return setup.summarize(draft);
}

function applyPolish(episode, presetId) {
  media.resetStore();
  let polish = audio.createPolish(episode);
  if (presetId) {
    polish = audio.applyPreset(polish, presetId);
  }
  const result = audio.runPolish(polish, episode, media, { episodeKey: EPISODE_KEY });
  assert.strictEqual(result.ok, true, result.error || "runPolish failed");
  return result.polish;
}

test("runPolish saves durable polished WAV assets for each imported speaker track", () => {
  const episode = uploadEpisode();
  const polish = applyPolish(episode, "clean");
  assert.strictEqual(polish.status, "complete");
  polish.speakers.forEach((track) => {
    assert.strictEqual(track.status, audio.TRACK_STATUS.COMPLETE);
    assert.ok(track.polishedAssetId.startsWith("polished/"));
    assert.ok(track.polishedSizeBytes > 44);
    assert.ok(media.hasAsset(track.polishedAssetId));
    const asset = media.getAsset(track.polishedAssetId);
    assert.strictEqual(asset.kind, "polished");
    const source = media.getAsset(track.sourceAssetId);
    assert.notStrictEqual(source.checksum, asset.checksum);
  });
});

test("runPolish fails when an imported upload track has no source file", () => {
  media.resetStore();
  const episode = uploadEpisode();
  episode.speakers[1].sourceLabel = "No file chosen";
  const result = audio.runPolish(audio.createPolish(episode), episode, media, { episodeKey: EPISODE_KEY });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.polish.status, "failed");
  assert.strictEqual(result.polish.speakers[1].status, audio.TRACK_STATUS.FAILED);
});

test("summarizePolish exposes export manifest that uses polished assets", () => {
  const episode = riversideEpisode();
  const summary = audio.summarizePolish(applyPolish(episode, "studio"), media);
  assert.strictEqual(summary.complete, true);
  assert.strictEqual(summary.usesPolishedForExport, true);
  assert.ok(summary.exportAudioLine.includes("polished WAV"));
  assert.strictEqual(summary.tracks.length, 3);
});

test("ACCEPTANCE: export and publish review require saved polished audio assets", () => {
  const episode = uploadEpisode();
  const unprocessed = audio.summarizePolish(audio.createPolish(episode), media);
  const processed = audio.summarizePolish(applyPolish(episode, "natural"), media);
  const appliedStyle = { presetName: "Studio Spotlight", layoutLabel: "Side by side", pacingLabel: "Balanced" };

  assert.strictEqual(exportModel.validateReadiness({ audioPolish: unprocessed, appliedStyle }).ok, false);
  assert.strictEqual(exportModel.validateReadiness({ audioPolish: processed, appliedStyle }).ok, true);

  const exportResult = exportModel.runExport(exportModel.createExport(episode), episode, {
    audioPolish: processed,
    appliedStyle,
    publishReviewApproved: true,
  });
  assert.strictEqual(exportResult.ok, true);
  assert.strictEqual(exportResult.state.usesPolishedAudio, true);
  assert.strictEqual(exportResult.state.audioManifest.tracks.length, 3);

  const reviewDraft = review.createReview(episode, {
    audioPolish: processed,
    appliedStyle,
    contextApproved: true,
    hasCanvas: false,
    captionCount: 0,
  });
  const audioCheck = reviewDraft.checks.find((item) => item.id === "audio-ready");
  assert.ok(audioCheck);
  assert.ok(/polished WAV/i.test(audioCheck.message));
});

console.log(`\naudio polish processing: ${passed} assertions passed`);
