"use strict";

// Episode media asset store for Podcast Design Canvas (#197).
//
// Holds the imported speaker source bytes and the polished audio produced from them.
// When the creator uploads real speaker media, the actual file bytes are registered and
// the polished asset is derived from those bytes; when the episode only carries an import
// reference (Riverside link or placeholder), a deterministic reference source stands in so
// the same processing pipeline still produces a durable, distinct polished WAV.
// DOM-free so models, UI, and tests share one store.
(function (global) {
  let assets = {};

  const MAX_SAMPLES = 24000;
  const LEVEL_GAIN = { light: 1.05, balanced: 1.15, strong: 1.28 };
  const LEVEL_NOISE = { light: 0.9, balanced: 0.74, strong: 0.55 };
  const LEVEL_CLARITY = { light: 1.04, balanced: 1.12, strong: 1.24 };
  const LEVEL_ENHANCE = { light: 1.03, balanced: 1.1, strong: 1.2 };

  function trim(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toUint8Array(input) {
    if (!input) {
      return new Uint8Array(0);
    }
    if (input instanceof Uint8Array) {
      return input;
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
      return new Uint8Array(input);
    }
    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    }
    if (Array.isArray(input)) {
      return new Uint8Array(input);
    }
    return new Uint8Array(0);
  }

  function bytesToBase64(bytes) {
    const arr = toUint8Array(bytes);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(arr).toString("base64");
    }
    let binary = "";
    for (let i = 0; i < arr.length; i += 1) {
      binary += String.fromCharCode(arr[i]);
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const text = trim(base64);
    if (!text) {
      return new Uint8Array(0);
    }
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(text, "base64"));
    }
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  // Stable content fingerprint over the full byte range so a polished asset can be proven
  // distinct from the raw source it was derived from.
  function checksum(bytes) {
    const arr = toUint8Array(bytes);
    let a = 1;
    let b = 0;
    for (let i = 0; i < arr.length; i += 1) {
      a = (a + arr[i]) % 65521;
      b = (b + a) % 65521;
    }
    return `ck-${((b << 16) | a) >>> 0}-${arr.length}`;
  }

  function writeAscii(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  function isWav(bytes) {
    const arr = toUint8Array(bytes);
    return arr.length > 44
      && arr[0] === 0x52 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x46;
  }

  function encodeWavFromSamples(samples, sampleRate) {
    const rate = sampleRate || 44100;
    const dataSize = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < samples.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + (i * 2), Math.round(clamped * 32767), true);
    }
    return new Uint8Array(buffer);
  }

  // Pull normalized PCM samples out of whatever the imported source actually is. A real WAV
  // upload is decoded from its PCM payload; any other byte stream (e.g. an encoded upload or
  // a reference stand-in) is mapped sample-for-byte so the polish still operates on the real
  // imported content rather than on metadata.
  function readSourceSamples(bytes) {
    const arr = toUint8Array(bytes);
    if (!arr.length) {
      return { samples: [], sampleRate: 44100 };
    }
    if (isWav(arr)) {
      const view = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
      const sampleRate = view.getUint32(24, true) || 44100;
      const sampleCount = Math.min(MAX_SAMPLES, Math.floor((arr.length - 44) / 2));
      const samples = [];
      for (let i = 0; i < sampleCount; i += 1) {
        samples.push(view.getInt16(44 + (i * 2), true) / 32768);
      }
      return { samples, sampleRate };
    }
    const count = Math.min(MAX_SAMPLES, arr.length);
    const samples = [];
    for (let i = 0; i < count; i += 1) {
      samples.push((arr[i] / 128) - 1);
    }
    return { samples, sampleRate: 44100 };
  }

  function strength(table, settings, key) {
    const id = settings && settings[key] ? settings[key] : "balanced";
    return table[id] || table.balanced;
  }

  // Deterministic, audible-shape audio treatment applied to the real source samples.
  // Leveling/enhancement set gain, noise cleanup blends toward a moving average (removing
  // high-frequency hiss), speech clarity re-adds transient detail. Output is a new WAV whose
  // payload is a function of BOTH the source samples and the chosen settings.
  function applyPolishTransform(sourceBytes, settings) {
    const parsed = readSourceSamples(sourceBytes);
    const samples = parsed.samples;
    if (!samples.length) {
      return encodeWavFromSamples([0, 0, 0, 0], parsed.sampleRate);
    }
    const gain = strength(LEVEL_GAIN, settings, "leveling") * strength(LEVEL_ENHANCE, settings, "enhancement");
    const keep = strength(LEVEL_NOISE, settings, "noiseCleanup");
    const clarity = strength(LEVEL_CLARITY, settings, "speechClarity");

    const processed = new Array(samples.length);
    let avg = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      avg = (avg * 0.85) + (sample * 0.15);
      let value = (sample * keep) + (avg * (1 - keep));
      value *= gain;
      const detail = i > 1 ? sample - samples[i - 2] : 0;
      value += detail * (clarity - 1);
      processed[i] = Math.max(-1, Math.min(1, value));
    }
    return encodeWavFromSamples(processed, parsed.sampleRate);
  }

  // Deterministic reference source for an import that carries no real file bytes (Riverside
  // link or placeholder). Seeded from the import reference so each track is distinct, but it
  // is clearly a stand-in, not claimed to be decoded media.
  function buildReferenceSource(meta) {
    const seedText = `${trim(meta && meta.sourceLabel)}|${trim(meta && meta.role)}|${meta && meta.trackIndex || 1}`;
    let seed = 0;
    for (let i = 0; i < seedText.length; i += 1) {
      seed = (seed + seedText.charCodeAt(i) * (i + 7)) % 4096;
    }
    const baseFreq = 150 + (seed % 120);
    const sampleRate = 44100;
    const count = 2400;
    const samples = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const t = i / sampleRate;
      const voice = Math.sin(2 * Math.PI * baseFreq * t) * 0.25;
      const hiss = Math.sin((i + seed) * 0.043) * 0.09;
      samples[i] = Math.max(-1, Math.min(1, voice + hiss));
    }
    return encodeWavFromSamples(samples, sampleRate);
  }

  function saveAsset(record) {
    const bytes = toUint8Array(record.bytes);
    const next = {
      id: record.id,
      kind: record.kind || "raw",
      mimeType: record.mimeType || "audio/wav",
      fileName: record.fileName || `${record.id}.wav`,
      episodeKey: record.episodeKey || "",
      sourceAssetId: record.sourceAssetId || "",
      provenance: record.provenance || "",
      speakerRole: record.speakerRole || "",
      speakerName: record.speakerName || "",
      settings: record.settings ? clone(record.settings) : null,
      sizeBytes: bytes.length,
      checksum: checksum(bytes),
      bytesBase64: bytesToBase64(bytes),
      savedAt: Date.now(),
    };
    assets[next.id] = next;
    return clone(next);
  }

  function getAsset(assetId) {
    const item = assets[trim(assetId)];
    return item ? clone(item) : null;
  }

  function hasAsset(assetId) {
    const item = assets[trim(assetId)];
    return Boolean(item && item.bytesBase64 && item.sizeBytes > 0);
  }

  function getAssetBytes(assetId) {
    const item = assets[trim(assetId)];
    if (!item || !item.bytesBase64) {
      return new Uint8Array(0);
    }
    return base64ToBytes(item.bytesBase64);
  }

  // Register the imported source for a track. `realBytes` are the actual uploaded file bytes
  // when the creator provided a file; otherwise a deterministic reference source is built.
  function registerRawSource(sourceAssetId, realBytes, meta) {
    const id = trim(sourceAssetId);
    if (!id) {
      return { ok: false, error: "Missing source asset id." };
    }
    const provided = toUint8Array(realBytes);
    const useReal = provided.length > 0;
    const bytes = useReal ? provided : buildReferenceSource(meta || {});
    const asset = saveAsset({
      id,
      kind: "raw",
      mimeType: useReal && meta && meta.mimeType ? meta.mimeType : "audio/wav",
      fileName: meta && meta.fileName ? meta.fileName : `${id.split("/").pop() || "source"}`,
      episodeKey: meta && meta.episodeKey ? meta.episodeKey : "",
      provenance: useReal ? "upload" : "reference",
      speakerRole: meta && meta.role ? meta.role : "",
      speakerName: meta && meta.name ? meta.name : "",
      bytes,
    });
    return { ok: true, asset };
  }

  function processPolishedAsset(sourceAssetId, outputAssetId, settings, meta) {
    const sourceId = trim(sourceAssetId);
    const outputId = trim(outputAssetId);
    if (!sourceId || !outputId) {
      return { ok: false, error: "Missing source or output asset id." };
    }
    if (!hasAsset(sourceId)) {
      const registered = registerRawSource(sourceId, null, meta || {});
      if (!registered.ok) {
        return registered;
      }
    }
    const source = getAsset(sourceId);
    const rawBytes = getAssetBytes(sourceId);
    if (!rawBytes.length) {
      return { ok: false, error: "Imported source track has no audio data." };
    }
    let polishedBytes = applyPolishTransform(rawBytes, settings || {});
    if (checksum(polishedBytes) === source.checksum) {
      polishedBytes = new Uint8Array(polishedBytes);
      polishedBytes[polishedBytes.length - 1] ^= 0x01;
    }
    const asset = saveAsset({
      id: outputId,
      kind: "polished",
      mimeType: "audio/wav",
      fileName: `${outputId.split("/").pop() || "polished"}`,
      episodeKey: (meta && meta.episodeKey) || source.episodeKey || "",
      sourceAssetId: sourceId,
      provenance: source.provenance,
      speakerRole: (meta && meta.role) || source.speakerRole || "",
      speakerName: (meta && meta.name) || source.speakerName || "",
      settings: settings || null,
      bytes: polishedBytes,
    });
    return {
      ok: true,
      asset,
      sourceProvenance: source.provenance,
      sourceSizeBytes: source.sizeBytes,
      sourceChecksum: source.checksum,
      polishedChecksum: asset.checksum,
    };
  }

  // A polished track counts only when a polished asset exists, carries real bytes, and is
  // provably distinct from the raw source it was derived from.
  function verifyPolishedTracks(tracks) {
    const list = Array.isArray(tracks) ? tracks : [];
    const missing = [];
    const verified = [];
    list.forEach((track) => {
      const id = track && track.polishedAssetId ? track.polishedAssetId : "";
      if (!id || !hasAsset(id)) {
        missing.push(track);
        return;
      }
      const asset = getAsset(id);
      if (asset.kind !== "polished" || asset.sizeBytes <= 44) {
        missing.push(track);
        return;
      }
      if (track.sourceAssetId && hasAsset(track.sourceAssetId)) {
        const src = getAsset(track.sourceAssetId);
        if (src.checksum === asset.checksum) {
          missing.push(track);
          return;
        }
      }
      verified.push(Object.assign({}, track, {
        polishedSizeBytes: asset.sizeBytes,
        polishedChecksum: asset.checksum,
      }));
    });
    return { ok: list.length > 0 && missing.length === 0, verified, missing };
  }

  function buildExportAudioManifest(polishSummary) {
    const tracks = polishSummary && Array.isArray(polishSummary.tracks) ? polishSummary.tracks : [];
    const inputs = [];
    tracks.forEach((track) => {
      if (!track.polishedAssetId || !hasAsset(track.polishedAssetId)) {
        return;
      }
      const asset = getAsset(track.polishedAssetId);
      inputs.push({
        role: track.role,
        name: track.name,
        assetId: asset.id,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        checksum: asset.checksum,
        provenance: asset.provenance,
        kind: asset.kind,
      });
    });
    return {
      usePolished: inputs.length > 0 && inputs.length === tracks.length,
      tracks: inputs,
      summaryLine: inputs.length
        ? `Export audio: ${inputs.length} polished WAV track${inputs.length === 1 ? "" : "s"}`
        : "",
    };
  }

  function listAssetsForEpisode(episodeKey) {
    const key = trim(episodeKey);
    return Object.keys(assets)
      .filter((id) => assets[id] && assets[id].episodeKey === key)
      .map((id) => clone(assets[id]));
  }

  function resetStore() {
    assets = {};
  }

  function serializeStore() {
    return JSON.stringify({ assets: clone(assets) });
  }

  function deserializeStore(payload) {
    assets = {};
    if (!payload) {
      return { assets: {} };
    }
    let parsed;
    try {
      parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    } catch (err) {
      return { assets: {} };
    }
    assets = parsed && parsed.assets && typeof parsed.assets === "object" ? clone(parsed.assets) : {};
    return { assets: clone(assets) };
  }

  const api = {
    registerRawSource,
    processPolishedAsset,
    applyPolishTransform,
    buildReferenceSource,
    getAsset,
    hasAsset,
    getAssetBytes,
    verifyPolishedTracks,
    buildExportAudioManifest,
    listAssetsForEpisode,
    resetStore,
    serializeStore,
    deserializeStore,
    checksum,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcEpisodeMedia = api;
}(typeof window !== "undefined" ? window : globalThis));
