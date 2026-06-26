"use strict";

// Episode media asset store smoke suite for Podcast Design Canvas (#197).
// Run with: `node tests/episode-media.test.js`.

const assert = require("assert");
const media = require("../app/episode-media.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

test("registerRawSourceAsset saves playable WAV bytes for an imported track", () => {
  media.resetStore();
  const saved = media.registerRawSourceAsset("raw-upload/demo/1-host-synced.mp4", {
    role: "Host",
    name: "Jordan Lee",
    sourceLabel: "host-synced.mp4",
    trackIndex: 1,
    episodeKey: "show-1:ep-1",
  });
  assert.strictEqual(saved.ok, true);
  assert.ok(saved.asset.sizeBytes > 44);
  assert.ok(media.hasAsset("raw-upload/demo/1-host-synced.mp4"));
  const bytes = media.getAssetBytes("raw-upload/demo/1-host-synced.mp4");
  assert.ok(bytes.length > 44);
  assert.strictEqual(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), "RIFF");
});

test("processPolishedAsset transforms source audio into a different polished WAV", () => {
  media.resetStore();
  const sourceId = "raw-riverside/https%3A%2F%2Friverside.fm%2Fdemo#track-1";
  media.registerRawSourceAsset(sourceId, {
    role: "Host",
    name: "Sam Rivera",
    sourceLabel: "Riverside track 1",
    trackIndex: 1,
    episodeKey: "show-1:ep-1",
  });
  const polishedId = "polished/demo/host-studio-v1.wav";
  const saved = media.processPolishedAsset(sourceId, polishedId, {
    presetId: "studio",
    noiseCleanup: "strong",
    leveling: "strong",
    speechClarity: "strong",
    enhancement: "strong",
  }, {
    role: "Host",
    name: "Sam Rivera",
    episodeKey: "show-1:ep-1",
  });
  assert.strictEqual(saved.ok, true);
  assert.notStrictEqual(saved.sourceChecksum, saved.polishedChecksum);
  const polished = media.getAsset(polishedId);
  assert.strictEqual(polished.kind, "polished");
  assert.ok(polished.sizeBytes > 44);
  assert.strictEqual(polished.sourceAssetId, sourceId);
});

test("serializeStore and deserializeStore round-trip saved assets", () => {
  media.resetStore();
  media.registerRawSourceAsset("raw-upload/demo/1-host-synced.mp4", {
    role: "Host",
    name: "Jordan Lee",
    sourceLabel: "host-synced.mp4",
    trackIndex: 1,
    episodeKey: "show-1:ep-1",
  });
  media.processPolishedAsset(
    "raw-upload/demo/1-host-synced.mp4",
    "polished/demo/host-clean-v1.wav",
    { noiseCleanup: "balanced", leveling: "balanced", speechClarity: "balanced", enhancement: "balanced" },
    { role: "Host", name: "Jordan Lee", episodeKey: "show-1:ep-1" },
  );
  const payload = media.serializeStore();
  media.resetStore();
  assert.strictEqual(media.hasAsset("polished/demo/host-clean-v1.wav"), false);
  media.deserializeStore(payload);
  assert.strictEqual(media.hasAsset("polished/demo/host-clean-v1.wav"), true);
  assert.strictEqual(media.getAsset("polished/demo/host-clean-v1.wav").kind, "polished");
});

console.log(`\nepisode media: ${passed} assertions passed`);
