"use strict";

// Canvas editor model for Podcast Design Canvas (#11).
//
// Turns an applied preset style + episode summary into an editable canvas document:
// layer stack, title text, background, and speaker frames from the real setup. DOM-free
// so the editor screen and tests share one source of truth.
(function (global) {
  function layersApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./canvas-layers.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcCanvasLayers;
  }

  function styleApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./episode-style.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcEpisodeStyle;
  }

  function previewApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./style-preview.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcStylePreview;
  }

  function defaultCaptionForPreset(presetId) {
    const SP = previewApi();
    if (SP && typeof SP.defaultCanvasCaption === "function") {
      return SP.defaultCanvasCaption(presetId);
    }
    return "Dana: Thanks for joining us on the show today.";
  }

  function cloneDoc(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  // Seed a layer stack from the chosen preset — backgrounds, speakers, captions, overlays.
  function seedLayersFromPreset(appliedStyle) {
    const CL = layersApi();
    if (!CL) {
      return [];
    }
    return [
      CL.createLayer("background", "l-bg"),
      CL.createLayer("speaker", "l-speaker"),
      CL.createLayer("captions", "l-captions"),
      CL.createLayer("lower-thirds", "l-lower-thirds"),
      CL.createLayer("title", "l-title"),
      CL.createLayer("broll", "l-broll"),
      CL.createLayer("brand", "l-brand", { locked: true }),
    ];
  }

  // Open the canvas editor from a completed style choice and episode summary.
  function createFromStyle(appliedStyle, episodeSummary, styleSelection) {
    const STY = styleApi();
    const style = appliedStyle || {};
    const episode = episodeSummary || {};
    const selection = styleSelection || {};
    const speakerFrames = STY
      ? STY.buildPreviewFrames(episode.speakers, selection, episode.speakerCount)
      : [];
    return {
      presetId: style.presetId,
      presetName: style.presetName,
      layoutId: style.layoutId,
      pacingId: style.pacingId,
      background: style.background || "#10131f",
      accent: style.accent || "#6c4cff",
      titleText: episode.episodeName || "Episode title",
      captionText: defaultCaptionForPreset(style.presetId),
      layers: seedLayersFromPreset(style),
      speakerFrames: speakerFrames,
    };
  }

  // Keep layout customizations but rebuild speaker frames from the current episode.
  function refreshSpeakerFrames(doc, episodeSummary, styleSelection) {
    const STY = styleApi();
    const next = cloneDoc(doc || createFromStyle({}, {}, {}));
    const episode = episodeSummary || {};
    const selection = styleSelection || {};
    if (STY) {
      next.speakerFrames = STY.buildPreviewFrames(
        episode.speakers,
        selection,
        episode.speakerCount,
      );
    }
    return next;
  }

  function updateElement(doc, key, value) {
    const next = cloneDoc(doc || createFromStyle({}, {}, {}));
    if (key === "titleText" || key === "captionText" || key === "background" || key === "accent") {
      next[key] = typeof value === "string" ? value : "";
    }
    return next;
  }

  function updateLayers(doc, layers) {
    const next = cloneDoc(doc || createFromStyle({}, {}, {}));
    const previous = Array.isArray(next.layers) ? next.layers : [];
    const incoming = Array.isArray(layers) ? layers.slice() : [];
    const CL = layersApi();
    if (CL && !CL.preservesLockedStackPositions(previous, incoming)) {
      return cloneDoc(doc || createFromStyle({}, {}, {}));
    }
    next.layers = incoming;
    return next;
  }

  function updateLayerBounds(doc, layerId, patch) {
    const CL = layersApi();
    const next = cloneDoc(doc || createFromStyle({}, {}, {}));
    const layers = Array.isArray(next.layers) ? next.layers : [];
    const index = CL ? CL.layerIndex(layers, layerId) : layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) {
      return cloneDoc(doc || createFromStyle({}, {}, {}));
    }
    const layer = layers[index];
    if (!CL || !CL.canTransformLayer(layer)) {
      return cloneDoc(doc || createFromStyle({}, {}, {}));
    }
    const bounds = CL.layerBounds(layer);
    const merged = CL.clampBounds(Object.assign({}, bounds, patch || {}));
    const copy = layers.slice();
    copy[index] = Object.assign({}, layer, { bounds: merged });
    next.layers = copy;
    return next;
  }

  function dragLayer(doc, layerId, dx, dy) {
    const CL = layersApi();
    const next = cloneDoc(doc || createFromStyle({}, {}, {}));
    const layers = Array.isArray(next.layers) ? next.layers : [];
    const index = CL ? CL.layerIndex(layers, layerId) : layers.findIndex((layer) => layer.id === layerId);
    if (index < 0 || !CL) {
      return cloneDoc(doc || createFromStyle({}, {}, {}));
    }
    const layer = layers[index];
    if (!CL.canTransformLayer(layer)) {
      return cloneDoc(doc || createFromStyle({}, {}, {}));
    }
    const copy = layers.slice();
    copy[index] = CL.dragLayerBounds(copy[index], dx, dy);
    next.layers = copy;
    return next;
  }

  function resizeLayer(doc, layerId, dw, dh) {
    const CL = layersApi();
    const next = cloneDoc(doc || createFromStyle({}, {}, {}));
    const layers = Array.isArray(next.layers) ? next.layers : [];
    const index = CL ? CL.layerIndex(layers, layerId) : layers.findIndex((layer) => layer.id === layerId);
    if (index < 0 || !CL) {
      return cloneDoc(doc || createFromStyle({}, {}, {}));
    }
    const layer = layers[index];
    if (!CL.canTransformLayer(layer)) {
      return cloneDoc(doc || createFromStyle({}, {}, {}));
    }
    const copy = layers.slice();
    copy[index] = CL.resizeLayerBounds(copy[index], dw, dh);
    next.layers = copy;
    return next;
  }

  function summarize(doc) {
    const canvas = doc || {};
    const layers = Array.isArray(canvas.layers) ? canvas.layers : [];
    return {
      presetName: canvas.presetName || "",
      titleText: canvas.titleText || "",
      layoutId: canvas.layoutId || "",
      layerCount: layers.length,
      visibleLayerCount: layers.filter((layer) => layer.visible).length,
      speakerCount: Array.isArray(canvas.speakerFrames) ? canvas.speakerFrames.length : 0,
    };
  }

  function validateForSave(doc) {
    const CL = layersApi();
    const layers = doc && Array.isArray(doc.layers) ? doc.layers : [];
    const title = (doc && doc.titleText) || "";
    if (!title.trim()) {
      return { ok: false, error: "Add a title for this layout." };
    }
    if (!CL) {
      return { ok: true };
    }
    const evaluation = CL.evaluateLayout(layers);
    if (evaluation.overall !== "ready") {
      const review = evaluation.checks.find((check) => check.tone === "review");
      return { ok: false, error: review ? review.title : "Review the layout before saving." };
    }
    return { ok: true };
  }

  const api = {
    createFromStyle,
    refreshSpeakerFrames,
    updateElement,
    updateLayers,
    updateLayerBounds,
    dragLayer,
    resizeLayer,
    summarize,
    validateForSave,
    cloneDoc,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcCanvasEditor = api;
}(typeof window !== "undefined" ? window : globalThis));
