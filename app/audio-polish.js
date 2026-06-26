"use strict";

// Creator-facing audio polish model for Podcast Design Canvas (#15, #197).
//
// Presents noise cleanup, leveling, speech clarity, and enhancement as simple quality
// choices tied to each imported speaker track — not technical audio processing settings.
// Applying a preset processes each imported speaker track into a durable polished WAV asset
// in the episode media store (#197); the step only counts as complete once every track has a
// saved polished output that is provably distinct from its raw imported source.
// DOM-free so the polish step and tests share one source of truth.
(function (global) {
  const QUALITY_PRESETS = [
    {
      id: "natural",
      name: "Natural",
      tagline: "Light touch — keeps the room feel with gentle cleanup.",
    },
    {
      id: "clean",
      name: "Clean",
      tagline: "Balanced polish for most podcast conversations.",
    },
    {
      id: "studio",
      name: "Studio",
      tagline: "Broadcast-ready clarity and presence.",
    },
  ];

  const CONTROLS = [
    {
      id: "noiseCleanup",
      label: "Noise cleanup",
      hint: "Reduce background hum, fan noise, and room rumble.",
    },
    {
      id: "leveling",
      label: "Voice leveling",
      hint: "Even out volume between speakers and moments.",
    },
    {
      id: "speechClarity",
      label: "Speech clarity",
      hint: "Bring forward consonants and vocal presence.",
    },
    {
      id: "enhancement",
      label: "Overall enhancement",
      hint: "Add warmth and polish without sounding overprocessed.",
    },
  ];

  const LEVELS = [
    { id: "light", label: "Light" },
    { id: "balanced", label: "Balanced" },
    { id: "strong", label: "Strong" },
  ];

  const PRESET_LEVELS = {
    natural: {
      noiseCleanup: "light",
      leveling: "light",
      speechClarity: "light",
      enhancement: "light",
    },
    clean: {
      noiseCleanup: "balanced",
      leveling: "balanced",
      speechClarity: "balanced",
      enhancement: "balanced",
    },
    studio: {
      noiseCleanup: "strong",
      leveling: "strong",
      speechClarity: "strong",
      enhancement: "strong",
    },
  };

  const TRACK_STATUS = {
    PENDING: "pending",
    PROCESSING: "processing",
    COMPLETE: "complete",
    FAILED: "failed",
  };

  function trim(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function safeFileStem(name) {
    const stem = trim(name).replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").toLowerCase();
    return stem || "episode";
  }

  function roleSlug(role) {
    return trim(role).toLowerCase().replace(/\s+/g, "-") || "speaker";
  }

  function mediaApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./episode-media.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcEpisodeMedia;
  }

  function defaultPreset() {
    return QUALITY_PRESETS[1];
  }

  function getPreset(id) {
    return QUALITY_PRESETS.find((preset) => preset.id === id) || defaultPreset();
  }

  function getLevel(id) {
    return LEVELS.find((level) => level.id === id) || LEVELS[1];
  }

  function getControl(id) {
    return CONTROLS.find((control) => control.id === id) || CONTROLS[0];
  }

  function buildSourceAssetId(episodeSummary, speaker, index) {
    const episode = episodeSummary || {};
    const sp = speaker || {};
    const mode = episode.sourceMode || "riverside";
    if (mode === "upload") {
      const file = trim(sp.sourceLabel);
      if (!file || file === "No file chosen") {
        return "";
      }
      return `raw-upload/${safeFileStem(episode.episodeName)}/${index + 1}-${file}`;
    }
    const link = trim(episode.riversideLink);
    if (!link) {
      return "";
    }
    return `raw-riverside/${encodeURIComponent(link)}#track-${index + 1}`;
  }

  function buildPolishedAssetId(episodeSummary, track, polish) {
    const preset = getPreset(polish && polish.presetId);
    return `polished/${safeFileStem(episodeSummary && episodeSummary.episodeName)}/${roleSlug(track.role)}-${preset.id}-v1.wav`;
  }

  function buildSpeakerTracks(episodeSummary) {
    const speakers = episodeSummary && Array.isArray(episodeSummary.speakers)
      ? episodeSummary.speakers
      : [];
    return speakers.map((speaker, index) => ({
      role: (speaker && speaker.role) || "Speaker",
      name: (speaker && speaker.name) || "Unnamed speaker",
      sourceLabel: (speaker && speaker.sourceLabel) || "Source track",
      trackIndex: index + 1,
      sourceAssetId: buildSourceAssetId(episodeSummary, speaker, index),
      status: TRACK_STATUS.PENDING,
      polishedAssetId: "",
      polishedAssetLabel: "",
      polishedSizeBytes: 0,
      polishedChecksum: "",
      sourceProvenance: "",
      sourceSizeBytes: 0,
      error: "",
      processedAt: null,
    }));
  }

  function createPolish(episodeSummary) {
    const preset = defaultPreset();
    const levels = PRESET_LEVELS[preset.id];
    return {
      presetId: preset.id,
      noiseCleanup: levels.noiseCleanup,
      leveling: levels.leveling,
      speechClarity: levels.speechClarity,
      enhancement: levels.enhancement,
      speakers: buildSpeakerTracks(episodeSummary),
      status: "draft",
      appliedAt: null,
    };
  }

  function applyPreset(polish, presetId) {
    const preset = getPreset(presetId);
    const levels = PRESET_LEVELS[preset.id] || PRESET_LEVELS.clean;
    return Object.assign({}, polish || createPolish({}), {
      presetId: preset.id,
      noiseCleanup: levels.noiseCleanup,
      leveling: levels.leveling,
      speechClarity: levels.speechClarity,
      enhancement: levels.enhancement,
      speakers: polish && polish.speakers ? polish.speakers.slice() : [],
      status: "draft",
    });
  }

  function updateControl(polish, controlId, levelId) {
    const next = Object.assign({}, polish || createPolish({}));
    if (CONTROLS.some((control) => control.id === controlId)) {
      next[controlId] = getLevel(levelId).id;
    }
    next.status = "draft";
    return next;
  }

  function trackSettings(polish) {
    return {
      presetId: polish.presetId,
      noiseCleanup: polish.noiseCleanup,
      leveling: polish.leveling,
      speechClarity: polish.speechClarity,
      enhancement: polish.enhancement,
    };
  }

  // Register every imported speaker source up front. Real uploaded bytes (keyed by source
  // asset id) are used when present; otherwise a deterministic reference source stands in.
  function registerEpisodeSources(episodeSummary, episodeKey, mediaStore, sourceBytesById) {
    const media = mediaStore || mediaApi();
    if (!media) {
      return { ok: false, error: "Media store unavailable." };
    }
    const speakers = episodeSummary && Array.isArray(episodeSummary.speakers)
      ? episodeSummary.speakers
      : [];
    const bytesMap = sourceBytesById || {};
    const results = speakers.map((speaker, index) => {
      const sourceId = buildSourceAssetId(episodeSummary, speaker, index);
      if (!sourceId) {
        return { ok: false, error: "Missing imported source." };
      }
      return media.registerRawSource(sourceId, bytesMap[sourceId] || null, {
        episodeKey,
        role: speaker.role,
        name: speaker.name,
        sourceLabel: speaker.sourceLabel,
        fileName: speaker.sourceLabel,
        trackIndex: index + 1,
      });
    });
    return { ok: results.every((item) => item.ok), results };
  }

  function processTrack(track, polish, episodeSummary, media, episodeKey) {
    const next = Object.assign({}, track || {});
    if (!media) {
      return Object.assign(next, { status: TRACK_STATUS.FAILED, error: "Media store unavailable." });
    }
    if (!trim(next.sourceAssetId)) {
      return Object.assign(next, {
        status: TRACK_STATUS.FAILED,
        error: "Missing imported source for this speaker track.",
        polishedAssetId: "",
        polishedAssetLabel: "",
      });
    }
    const preset = getPreset(polish.presetId);
    const polishedAssetId = buildPolishedAssetId(episodeSummary, next, polish);
    const saved = media.processPolishedAsset(next.sourceAssetId, polishedAssetId, trackSettings(polish), {
      episodeKey: episodeKey || "",
      role: next.role,
      name: next.name,
    });
    if (!saved.ok || !saved.asset) {
      return Object.assign(next, {
        status: TRACK_STATUS.FAILED,
        error: saved.error || "Could not save polished audio for this track.",
        polishedAssetId: "",
        polishedAssetLabel: "",
      });
    }
    return Object.assign(next, {
      status: TRACK_STATUS.COMPLETE,
      polishedAssetId: saved.asset.id,
      polishedAssetLabel: `${next.name} · ${preset.name} audio`,
      polishedSizeBytes: saved.asset.sizeBytes,
      polishedChecksum: saved.asset.checksum,
      sourceProvenance: saved.sourceProvenance || "reference",
      sourceSizeBytes: saved.sourceSizeBytes || 0,
      error: "",
      processedAt: Date.now(),
      settings: trackSettings(polish),
    });
  }

  function isPolishComplete(polish, mediaStore) {
    const speakers = polish && Array.isArray(polish.speakers) ? polish.speakers : [];
    if (!speakers.length || !speakers.every((track) => track.status === TRACK_STATUS.COMPLETE)) {
      return false;
    }
    const media = mediaStore || mediaApi();
    if (!media) {
      return false;
    }
    return media.verifyPolishedTracks(speakers).ok;
  }

  function runPolish(polish, episodeSummary, mediaStore, options) {
    const media = mediaStore || mediaApi();
    const opts = options || {};
    const episodeKey = opts.episodeKey || "";
    const base = Object.assign({}, polish || createPolish(episodeSummary));

    if (media) {
      registerEpisodeSources(episodeSummary, episodeKey, media, opts.sourceBytesById || {});
    }

    const freshTracks = buildSpeakerTracks(episodeSummary);
    const mergedTracks = freshTracks.map((fresh, index) => {
      const existing = base.speakers && base.speakers[index];
      return Object.assign({}, fresh, existing || {}, {
        sourceAssetId: fresh.sourceAssetId,
        status: TRACK_STATUS.PROCESSING,
        error: "",
      });
    });

    const processed = mergedTracks.map((track) => processTrack(track, base, episodeSummary, media, episodeKey));
    const failed = processed.filter((track) => track.status === TRACK_STATUS.FAILED);
    const next = Object.assign({}, base, {
      speakers: processed,
      status: failed.length ? "failed" : "complete",
      appliedAt: Date.now(),
    });

    if (failed.length) {
      return {
        ok: false,
        polish: next,
        error: "Could not polish every imported speaker track. Fix missing sources and try again.",
        failedTracks: failed,
      };
    }
    if (!isPolishComplete(next, media)) {
      return {
        ok: false,
        polish: Object.assign({}, next, { status: "failed" }),
        error: "Polished audio assets were not saved for every speaker track.",
        failedTracks: processed,
      };
    }
    return { ok: true, polish: next };
  }

  function polishedTrackLines(polish) {
    const speakers = polish && Array.isArray(polish.speakers) ? polish.speakers : [];
    return speakers
      .filter((track) => track.status === TRACK_STATUS.COMPLETE && track.polishedAssetLabel)
      .map((track) => track.polishedAssetLabel);
  }

  function speakerIndicator(polish, speaker) {
    const track = speaker || {};
    if (track.status === TRACK_STATUS.COMPLETE && track.polishedAssetLabel) {
      return track.polishedAssetLabel;
    }
    if (track.status === TRACK_STATUS.FAILED && track.error) {
      return `Failed · ${track.error}`;
    }
    const preset = getPreset(polish && polish.presetId);
    const name = track.name || "Speaker";
    return `${preset.name} treatment · ${name}`;
  }

  function trackStatusLabel(status) {
    switch (status) {
      case TRACK_STATUS.COMPLETE:
        return "Polished";
      case TRACK_STATUS.FAILED:
        return "Failed";
      case TRACK_STATUS.PROCESSING:
        return "Processing";
      default:
        return "Ready to polish";
    }
  }

  function provenanceLabel(provenance) {
    return provenance === "upload" ? "from uploaded file" : "from imported reference";
  }

  function summarizePolish(polish, mediaStore) {
    const state = polish || createPolish({});
    const preset = getPreset(state.presetId);
    const media = mediaStore || mediaApi();
    const controlSummary = CONTROLS.map((control) => {
      const level = getLevel(state[control.id]);
      return `${control.label}: ${level.label}`;
    });
    const tracks = (state.speakers || []).map((track) => ({
      role: track.role,
      name: track.name,
      sourceAssetId: track.sourceAssetId,
      sourceProvenance: track.sourceProvenance || "",
      sourceSizeBytes: track.sourceSizeBytes || 0,
      polishedAssetId: track.polishedAssetId,
      polishedAssetLabel: track.polishedAssetLabel,
      polishedSizeBytes: track.polishedSizeBytes || 0,
      polishedChecksum: track.polishedChecksum || "",
      status: track.status,
      statusLabel: trackStatusLabel(track.status),
      provenanceLabel: track.sourceProvenance ? provenanceLabel(track.sourceProvenance) : "",
      error: track.error || "",
    }));
    const completeCount = tracks.filter((track) => track.status === TRACK_STATUS.COMPLETE).length;
    const polishedTrackLine = completeCount
      ? `${completeCount} polished audio track${completeCount === 1 ? "" : "s"} saved`
      : "";
    const manifest = media ? media.buildExportAudioManifest({ tracks }) : { usePolished: false, summaryLine: "" };

    return {
      presetId: preset.id,
      presetName: preset.name,
      tagline: preset.tagline,
      noiseCleanup: state.noiseCleanup,
      noiseCleanupLabel: getLevel(state.noiseCleanup).label,
      leveling: state.leveling,
      levelingLabel: getLevel(state.leveling).label,
      speechClarity: state.speechClarity,
      speechClarityLabel: getLevel(state.speechClarity).label,
      enhancement: state.enhancement,
      enhancementLabel: getLevel(state.enhancement).label,
      speakerCount: tracks.length,
      treatmentLine: controlSummary.join(" · "),
      status: state.status || "draft",
      appliedAt: state.appliedAt || null,
      complete: isPolishComplete(state, media),
      tracks,
      polishedTrackLine,
      polishedTrackLabels: polishedTrackLines(state),
      exportAudioLine: manifest.usePolished ? manifest.summaryLine : "",
      usesPolishedForExport: manifest.usePolished,
    };
  }

  function buildReviewSummary(episodeSummary, polishSummary, extras) {
    const episode = episodeSummary || {};
    const audio = polishSummary || {};
    const options = extras || {};
    const lines = [];
    if (audio.presetName && audio.complete) {
      lines.push(`Audio: ${audio.presetName} (${audio.treatmentLine})`);
      if (audio.exportAudioLine) {
        lines.push(audio.exportAudioLine);
      } else if (audio.polishedTrackLine) {
        lines.push(audio.polishedTrackLine);
      }
    } else if (audio.presetName) {
      lines.push(`Audio: ${audio.presetName} (not yet processed)`);
    }
    if (options.styleName) {
      lines.push(`Visual style: ${options.styleName}`);
    }
    if (options.templateName) {
      lines.push(`Show template: ${options.templateName}`);
    }
    return {
      episodeName: episode.episodeName || "",
      speakerCount: episode.speakerCount || 0,
      audioPreset: audio.presetName || "",
      audioTreatment: audio.treatmentLine || "",
      styleName: options.styleName || "",
      templateName: options.templateName || "",
      readyForExport: Boolean(audio.presetName && audio.complete && audio.usesPolishedForExport),
      summaryLines: lines,
    };
  }

  const api = {
    QUALITY_PRESETS,
    CONTROLS,
    LEVELS,
    TRACK_STATUS,
    defaultPreset,
    getPreset,
    getLevel,
    getControl,
    buildSpeakerTracks,
    buildSourceAssetId,
    buildPolishedAssetId,
    registerEpisodeSources,
    createPolish,
    applyPreset,
    updateControl,
    runPolish,
    isPolishComplete,
    speakerIndicator,
    trackStatusLabel,
    summarizePolish,
    buildReviewSummary,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcAudioPolish = api;
}(typeof window !== "undefined" ? window : globalThis));
