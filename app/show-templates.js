"use strict";

// Named show template store for Podcast Design Canvas (#11).
//
// Saves customized canvas documents as reusable show templates creators can pick on
// future episodes. DOM-free — persistence is handled by the UI layer (localStorage).
(function (global) {
  let templateCounter = 0;

  function styleApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./episode-style.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcEpisodeStyle;
  }

  function editorApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./canvas-editor.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcCanvasEditor;
  }

  function createStore() {
    return { templates: [] };
  }

  function cloneCanvas(canvas) {
    return JSON.parse(JSON.stringify(canvas));
  }

  function normalizeName(name) {
    return typeof name === "string" ? name.trim() : "";
  }

  function validateTemplateName(store, name, excludeId) {
    const trimmed = normalizeName(name);
    if (!trimmed) {
      return { ok: false, error: "Give your show template a name." };
    }
    const list = store && Array.isArray(store.templates) ? store.templates : [];
    const duplicate = list.find(
      (template) => template.name.toLowerCase() === trimmed.toLowerCase() && template.id !== excludeId,
    );
    if (duplicate) {
      return { ok: false, error: "A template with that name already exists." };
    }
    return { ok: true, name: trimmed };
  }

  function createTemplate(name, canvasDoc, id) {
    templateCounter += 1;
    return {
      id: id || `tpl-${templateCounter}`,
      name: normalizeName(name),
      createdAt: Date.now(),
      canvas: cloneCanvas(canvasDoc),
    };
  }

  function saveTemplate(store, template) {
    const next = createStore();
    const existing = store && Array.isArray(store.templates) ? store.templates : [];
    next.templates = existing.slice();
    const index = next.templates.findIndex((item) => item.id === template.id);
    if (index >= 0) {
      next.templates[index] = Object.assign({}, template, { canvas: cloneCanvas(template.canvas) });
    } else {
      next.templates.push(
        Object.assign({}, template, { canvas: cloneCanvas(template.canvas) }),
      );
    }
    next.templates.sort((a, b) => a.name.localeCompare(b.name));
    return next;
  }

  function listTemplates(store) {
    const list = store && Array.isArray(store.templates) ? store.templates : [];
    return list.map((template) => ({
      id: template.id,
      name: template.name,
      createdAt: template.createdAt,
      presetName: template.canvas && template.canvas.presetName,
      titleText: template.canvas && template.canvas.titleText,
    }));
  }

  function getTemplate(store, id) {
    const list = store && Array.isArray(store.templates) ? store.templates : [];
    const found = list.find((template) => template.id === id);
    if (!found) {
      return null;
    }
    return Object.assign({}, found, { canvas: cloneCanvas(found.canvas) });
  }

  function applyTemplate(template) {
    if (!template || !template.canvas) {
      return null;
    }
    return cloneCanvas(template.canvas);
  }

  // Apply a saved template to a new episode — layout and style settings carry over,
  // speaker frames rebuild from the current episode's assigned speakers.
  function applyTemplateForEpisode(template, episodeSummary, styleSelection) {
    const canvas = applyTemplate(template);
    if (!canvas) {
      return null;
    }
    const CE = editorApi();
    const STY = styleApi();
    const episode = episodeSummary || {};
    const selection = styleSelection || {};
    if (CE && typeof CE.refreshSpeakerFrames === "function") {
      return CE.refreshSpeakerFrames(canvas, episode, selection);
    }
    if (STY) {
      canvas.speakerFrames = STY.buildPreviewFrames(
        episode.speakers,
        selection,
        episode.speakerCount,
      );
    }
    return canvas;
  }

  function styleSelectionFromCanvas(canvas) {
    const STY = styleApi();
    if (!STY || !canvas) {
      return null;
    }
    const selection = STY.createSelection();
    selection.presetId = canvas.presetId || selection.presetId;
    selection.layout = canvas.layoutId || selection.layout;
    selection.pacing = canvas.pacingId || selection.pacing;
    return selection;
  }

  function serializeStore(store) {
    return JSON.stringify(store || createStore());
  }

  function deserializeStore(json) {
    if (!json) {
      return createStore();
    }
    try {
      const parsed = JSON.parse(json);
      if (!parsed || !Array.isArray(parsed.templates)) {
        return createStore();
      }
      return { templates: parsed.templates };
    } catch (err) {
      return createStore();
    }
  }

  function _resetTemplateCounter() {
    templateCounter = 0;
  }

  const api = {
    createStore,
    validateTemplateName,
    createTemplate,
    saveTemplate,
    listTemplates,
    getTemplate,
    applyTemplate,
    applyTemplateForEpisode,
    styleSelectionFromCanvas,
    serializeStore,
    deserializeStore,
    _resetTemplateCounter,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcShowTemplates = api;
}(typeof window !== "undefined" ? window : globalThis));
