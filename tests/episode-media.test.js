"use strict";

// Episode media asset store suite for Podcast Design Canvas (#197).
// Verifies that imported sources are transformed into durable, distinct polished WAV assets,
// that real provided bytes are used as the source, and that the store survives serialization.
// Run with: `node tests/episode-media.test.js`.

const assert = require("assert");
const media = require("../app/episode-media.js");

let passed = 0;
function test(name, fn) {
  media.resetStore();
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

test("a reference source is built when no real bytes are imported", () => {
  const registered = media.registerRawSource("raw/host", null, { role: "Host", sourceLabel: "riverside", trackIndex: 1 });
  assert.strictEqual(registered.ok, true);
  assert.strictEqual(registered.asset.provenance, "reference");
  assert.ok(registered.asset.sizeBytes > 44, "reference source carries WAV bytes");
});

test("real imported bytes become the raw source", () => {
  const realBytes = new Uint8Array(512);
  for (let i = 0; i < realBytes.length; i += 1) {
    realBytes[i] = (i * 7 + 13) % 256;
  }
  const registered = media.registerRawSource("raw/upload", realBytes, { role: "Host", fileName: "sam.mp4" });
  assert.strictEqual(registered.ok, true);
  assert.strictEqual(registered.asset.provenance, "upload");
  assert.strictEqual(registered.asset.sizeBytes, 512);
  assert.strictEqual(media.getAsset("raw/upload").checksum, media.checksum(realBytes));
});

test("processing produces a polished WAV distinct from the source", () => {
  const realBytes = new Uint8Array(2048);
  for (let i = 0; i < realBytes.length; i += 1) {
    realBytes[i] = (i * 3) % 256;
  }
  media.registerRawSource("raw/a", realBytes, { role: "Host" });
  const result = media.processPolishedAsset("raw/a", "polished/a", {
    presetId: "studio",
    noiseCleanup: "strong",
    leveling: "strong",
    speechClarity: "strong",
    enhancement: "strong",
  }, { role: "Host" });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.sourceProvenance, "upload");
  assert.strictEqual(result.asset.kind, "polished");
  assert.ok(result.asset.sizeBytes > 44, "polished WAV carries real bytes");
  assert.notStrictEqual(result.polishedChecksum, result.sourceChecksum, "polished differs from source");
});

test("different settings produce different polished bytes from the same source", () => {
  const realBytes = new Uint8Array(2048);
  for (let i = 0; i < realBytes.length; i += 1) {
    realBytes[i] = (i * 5 + 1) % 256;
  }
  media.registerRawSource("raw/b", realBytes, { role: "Host" });
  const light = media.processPolishedAsset("raw/b", "polished/b-light", { presetId: "natural", noiseCleanup: "light", leveling: "light", speechClarity: "light", enhancement: "light" }, {});
  const strong = media.processPolishedAsset("raw/b", "polished/b-strong", { presetId: "studio", noiseCleanup: "strong", leveling: "strong", speechClarity: "strong", enhancement: "strong" }, {});
  assert.notStrictEqual(light.polishedChecksum, strong.polishedChecksum, "preset choice changes the polished output");
});

test("verifyPolishedTracks requires a saved, distinct polished asset for every track", () => {
  media.registerRawSource("raw/c", new Uint8Array([10, 20, 30, 40, 50, 60]), { role: "Host" });
  media.processPolishedAsset("raw/c", "polished/c", { presetId: "clean" }, {});
  const ok = media.verifyPolishedTracks([{ sourceAssetId: "raw/c", polishedAssetId: "polished/c" }]);
  assert.strictEqual(ok.ok, true);

  const missing = media.verifyPolishedTracks([
    { sourceAssetId: "raw/c", polishedAssetId: "polished/c" },
    { sourceAssetId: "raw/missing", polishedAssetId: "polished/missing" },
  ]);
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.missing.length, 1);
});

test("buildExportAudioManifest only uses polished when every track is saved", () => {
  media.registerRawSource("raw/d", new Uint8Array([1, 2, 3, 4]), { role: "Host" });
  media.processPolishedAsset("raw/d", "polished/d", { presetId: "clean" }, {});
  const manifest = media.buildExportAudioManifest({
    tracks: [{ role: "Host", name: "Sam", polishedAssetId: "polished/d" }],
  });
  assert.strictEqual(manifest.usePolished, true);
  assert.strictEqual(manifest.tracks.length, 1);

  const partial = media.buildExportAudioManifest({
    tracks: [
      { role: "Host", name: "Sam", polishedAssetId: "polished/d" },
      { role: "Guest", name: "Dana", polishedAssetId: "polished/none" },
    ],
  });
  assert.strictEqual(partial.usePolished, false);
});

test("ACCEPTANCE: store survives serialize/deserialize so polished assets persist a reload", () => {
  media.registerRawSource("raw/e", new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]), { role: "Host", episodeKey: "show:ep" });
  const saved = media.processPolishedAsset("raw/e", "polished/e", { presetId: "clean" }, { episodeKey: "show:ep" });
  const serialized = media.serializeStore();

  media.resetStore();
  assert.strictEqual(media.hasAsset("polished/e"), false, "store cleared before reload");

  media.deserializeStore(serialized);
  assert.strictEqual(media.hasAsset("polished/e"), true, "polished asset restored after reload");
  const restored = media.getAsset("polished/e");
  assert.strictEqual(restored.checksum, saved.polishedChecksum);
  assert.strictEqual(media.listAssetsForEpisode("show:ep").length, 2);
});

console.log(`\nepisode media: ${passed} assertions passed`);
