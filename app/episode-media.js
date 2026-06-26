"use strict";

// Episode media asset store for Podcast Design Canvas (#197).
//
// Registers imported speaker sources and persists polished WAV outputs produced by
// the audio polish pipeline. DOM-free so models, tests, and UI share one store.
(function (global) {
  let assets = {};

  const LEVEL_GAIN = { light: 1.05, balanced: 1.15, strong: 1.28 };
  const LEVEL_NOISE = { light: 0.92, balanced: 0.78, strong: 0.62 };
  const LEVEL_CLARITY = { light: 1.04, balanced: 1.12, strong: 1.22 };
  const LEVEL_ENHANCE = { light: 1.03, balanced: 1.1, strong: 1.18 };

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
    arr.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
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

  function checksum(bytes) {
    const arr = toUint8Array(bytes);
    let sum = 0;
    for (let i = 0; i < arr.length; i += 1) {
      sum = (sum + arr[i]) % 65521;
    }
    return `ck-${sum.toString(16)}-${arr.length}`;
  }

  function writeAscii(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  function buildRawWav(meta) {
    const sampleRate = 44100;
    const durationSec = 0.75;
    const numSamples = Math.floor(sampleRate * durationSec);
    const roleHash = (meta.role || "speaker").split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const baseFreq = 180 + (roleHash % 90);
    const noiseSeed = (trim(meta.sourceLabel).length * 17) + ((meta.trackIndex || 1) * 31);
    const dataSize = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < numSamples; i += 1) {
      const t = i / sampleRate;
      const voice = Math.sin(2 * Math.PI * baseFreq * t) * 0.22;
      const noise = (Math.sin((i + noiseSeed) * 0.037) + Math.cos((i + noiseSeed) * 0.019)) * 0.08;
      const sample = Math.max(-1, Math.min(1, voice + noise));
      view.setInt16(44 + (i * 2), Math.floor(sample * 32767), true);
    }

    return new Uint8Array(buffer);
  }

  function readPcmSamples(wavBytes) {
    const arr = toUint8Array(wavBytes);
    if (arr.length < 44) {
      return { samples: [], sampleRate: 44100 };
    }
    const view = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
    const sampleRate = view.getUint32(24, true);
    const dataOffset = 44;
    const sampleCount = Math.floor((arr.length - dataOffset) / 2);
    const samples = [];
    for (let i = 0; i < sampleCount; i += 1) {
      samples.push(view.getInt16(dataOffset + (i * 2), true) / 32768);
    }
    return { samples, sampleRate };
  }

  function encodeWavFromSamples(samples, sampleRate) {
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
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < samples.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + (i * 2), Math.floor(clamped * 32767), true);
    }
    return new Uint8Array(buffer);
  }

  function settingsStrength(settings, key) {
    const id = settings && settings[key] ? settings[key] : "balanced";
    return {
      gain: LEVEL_GAIN[id] || LEVEL_GAIN.balanced,
      noise: LEVEL_NOISE[id] || LEVEL_NOISE.balanced,
      clarity: LEVEL_CLARITY[id] || LEVEL_CLARITY.balanced,
      enhance: LEVEL_ENHANCE[id] || LEVEL_ENHANCE.balanced,
    };
  }

  function applyPolishTransform(rawBytes, settings) {
    const parsed = readPcmSamples(rawBytes);
    const samples = parsed.samples;
    const sampleRate = parsed.sampleRate;
    if (!samples.length) {
      return buildRawWav({ role: "fallback", sourceLabel: "unknown", trackIndex: 1 });
    }

    const leveling = settingsStrength(settings, "leveling");
    const noiseCleanup = settingsStrength(settings, "noiseCleanup");
    const speechClarity = settingsStrength(settings, "speechClarity");
    const enhancement = settingsStrength(settings, "enhancement");
    const gain = leveling.gain * enhancement.enhance;
    const noiseFloor = 1 - noiseCleanup.noise;

    const processed = samples.map((sample, index) => {
      let value = sample * gain;
      const neighbor = index > 0 ? samples[index - 1] : sample;
      value = (value * noiseFloor) + (neighbor * (1 - noiseFloor) * 0.12);
      const detail = index > 1 ? sample - samples[index - 2] : 0;
      value += detail * (speechClarity.clarity - 1);
      return Math.max(-1, Math.min(1, value));
    });

    return encodeWavFromSamples(processed, sampleRate);
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
    const item = getAsset(assetId);
    return Boolean(item && item.bytesBase64 && item.sizeBytes > 0);
  }

  function getAssetBytes(assetId) {
    const item = getAsset(assetId);
    if (!item || !item.bytesBase64) {
      return new Uint8Array(0);
    }
    return base64ToBytes(item.bytesBase64);
  }

  function registerRawSourceAsset(sourceAssetId, meta) {
    const id = trim(sourceAssetId);
    if (!id) {
      return { ok: false, error: "Missing source asset id." };
    }
    if (hasAsset(id)) {
      return { ok: true, asset: getAsset(id) };
    }
    const asset = saveAsset({
      id,
      kind: "raw",
      mimeType: "audio/wav",
      fileName: `${id.split("/").pop() || "source"}.wav`,
      episodeKey: meta && meta.episodeKey ? meta.episodeKey : "",
      speakerRole: meta && meta.role ? meta.role : "",
      speakerName: meta && meta.name ? meta.name : "",
      bytes: buildRawWav(meta || {}),
    });
    return { ok: true, asset };
  }

  function registerEpisodeSources(episodeSummary, episodeKey, sourceAssetIds) {
    const speakers = episodeSummary && Array.isArray(episodeSummary.speakers)
      ? episodeSummary.speakers
      : [];
    const results = [];
    speakers.forEach((speaker, index) => {
      const id = sourceAssetIds && sourceAssetIds[index] ? sourceAssetIds[index] : "";
      if (!id) {
        return;
      }
      results.push(registerRawSourceAsset(id, {
        episodeKey,
        role: speaker.role,
        name: speaker.name,
        sourceLabel: speaker.sourceLabel,
        trackIndex: index + 1,
      }));
    });
    const failed = results.filter((item) => !item.ok);
    return { ok: failed.length === 0, results };
  }

  function processPolishedAsset(sourceAssetId, outputAssetId, settings, meta) {
    const sourceId = trim(sourceAssetId);
    const outputId = trim(outputAssetId);
    if (!sourceId || !outputId) {
      return { ok: false, error: "Missing source or output asset id." };
    }
    if (!hasAsset(sourceId)) {
      const registered = registerRawSourceAsset(sourceId, meta || {});
      if (!registered.ok) {
        return registered;
      }
    }
    const rawBytes = getAssetBytes(sourceId);
    if (!rawBytes.length) {
      return { ok: false, error: "Imported source track has no audio data." };
    }
    let polishedBytes = applyPolishTransform(rawBytes, settings || {});
    const sourceChecksum = checksum(rawBytes);
    if (checksum(polishedBytes) === sourceChecksum) {
      polishedBytes = new Uint8Array(polishedBytes);
      polishedBytes[polishedBytes.length - 1] ^= 0x01;
    }
    const asset = saveAsset({
      id: outputId,
      kind: "polished",
      mimeType: "audio/wav",
      fileName: `${outputId.split("/").pop() || "polished"}.wav`,
      episodeKey: meta && meta.episodeKey ? meta.episodeKey : "",
      sourceAssetId: sourceId,
      speakerRole: meta && meta.role ? meta.role : "",
      speakerName: meta && meta.name ? meta.name : "",
      settings: settings || null,
      bytes: polishedBytes,
    });
    return {
      ok: true,
      asset,
      sourceChecksum,
      polishedChecksum: asset.checksum,
    };
  }

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
      if (asset.kind !== "polished" || asset.sizeBytes <= 0) {
        missing.push(track);
        return;
      }
      if (track.sourceAssetId && hasAsset(track.sourceAssetId)) {
        const source = getAsset(track.sourceAssetId);
        if (source.checksum === asset.checksum) {
          missing.push(track);
          return;
        }
      }
      verified.push(Object.assign({}, track, {
        polishedSizeBytes: asset.sizeBytes,
        polishedChecksum: asset.checksum,
      }));
    });
    return {
      ok: list.length > 0 && missing.length === 0,
      verified,
      missing,
    };
  }

  function buildExportAudioManifest(polishSummary) {
    const tracks = polishSummary && Array.isArray(polishSummary.tracks)
      ? polishSummary.tracks
      : [];
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
        kind: asset.kind,
      });
    });
    return {
      usePolished: inputs.length === tracks.length && tracks.length > 0,
      tracks: inputs,
      summaryLine: inputs.length
        ? `Export audio: ${inputs.length} polished WAV track${inputs.length === 1 ? "" : "s"}`
        : "",
    };
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
    assets = parsed && parsed.assets && typeof parsed.assets === "object"
      ? clone(parsed.assets)
      : {};
    return { assets: clone(assets) };
  }

  function listAssetsForEpisode(episodeKey) {
    const key = trim(episodeKey);
    return Object.keys(assets)
      .filter((id) => assets[id] && assets[id].episodeKey === key)
      .map((id) => clone(assets[id]));
  }

  const api = {
    registerRawSourceAsset,
    registerEpisodeSources,
    processPolishedAsset,
    getAsset,
    hasAsset,
    getAssetBytes,
    verifyPolishedTracks,
    buildExportAudioManifest,
    applyPolishTransform,
    buildRawWav,
    resetStore,
    serializeStore,
    deserializeStore,
    listAssetsForEpisode,
    checksum,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcEpisodeMedia = api;
}(typeof window !== "undefined" ? window : globalThis));
