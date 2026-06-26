"use strict";

// Canvas layer stack + locking rules for Podcast Design Canvas.
//
// Locking fixes a layer's position in the stack and on-stage bounds. Reorder and drag
// primitives respect locked layers: a locked layer cannot move itself, and neighbors
// cannot displace it. DOM-free so the screen and tests share one source of truth.
(function (global) {
  const LAYER_TYPES = {
    speaker: { label: "Speaker video frame", swatch: "#6c4cff", brand: false },
    captions: { label: "Captions", swatch: "#1b1c2e", brand: false },
    "lower-thirds": { label: "Lower-third", swatch: "#4a3aff", brand: false },
    title: { label: "Title moment", swatch: "#ff7a59", brand: false },
    broll: { label: "B-roll zone", swatch: "#9aa0c3", brand: false },
    background: { label: "Shape / background", swatch: "#2a2d4a", brand: false },
    brand: { label: "Logo / show branding", swatch: "#c8324a", brand: true },
    "safe-area": { label: "Safe-area guide", swatch: "#5b5d77", brand: false },
  };

  const DEFAULT_BOUNDS = {
    background: { x: 0, y: 0, w: 100, h: 100 },
    speaker: { x: 12, y: 16, w: 76, h: 62 },
    title: { x: 14, y: 10, w: 72, h: 18 },
    captions: { x: 14, y: 77, w: 72, h: 14 },
    "lower-thirds": { x: 8, y: 62, w: 42, h: 12 },
    broll: { x: 62, y: 30, w: 30, h: 30 },
    brand: { x: 72, y: 73, w: 22, h: 18 },
    "safe-area": { x: 6, y: 6, w: 88, h: 88 },
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function defaultBoundsForType(type) {
    const bounds = DEFAULT_BOUNDS[type];
    if (!bounds) {
      return { x: 10, y: 10, w: 40, h: 20 };
    }
    return Object.assign({}, bounds);
  }

  function clampBounds(bounds) {
    const raw = bounds && typeof bounds === "object" ? bounds : {};
    const w = clamp(Number(raw.w) || 10, 4, 100);
    const h = clamp(Number(raw.h) || 10, 4, 100);
    const x = clamp(Number(raw.x) || 0, 0, 100 - w);
    const y = clamp(Number(raw.y) || 0, 0, 100 - h);
    return { x, y, w, h };
  }

  function layerBounds(layer) {
    const data = layer && typeof layer === "object" ? layer : {};
    return clampBounds(data.bounds || defaultBoundsForType(data.type));
  }

  function getLayerType(type) {
    return LAYER_TYPES[type] || { label: "Layer", swatch: "#5b5d77", brand: false };
  }

  function createLayer(type, id, options) {
    const opts = options || {};
    const meta = getLayerType(type);
    return {
      id: id || `layer-${Date.now()}`,
      type: type,
      visible: opts.visible !== false,
      locked: Boolean(opts.locked),
      brand: meta.brand,
      bounds: clampBounds(opts.bounds || defaultBoundsForType(type)),
    };
  }

  function sampleLayers() {
    return [
      createLayer("captions", "l1"),
      createLayer("speaker", "l2"),
      createLayer("lower-thirds", "l3"),
      createLayer("title", "l4"),
      createLayer("brand", "l5", { locked: true }),
    ];
  }

  function layerIndex(layers, id) {
    if (!Array.isArray(layers)) {
      return -1;
    }
    return layers.findIndex((layer) => layer && layer.id === id);
  }

  function preservesLockedStackPositions(before, after) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      return false;
    }
    for (let i = 0; i < before.length; i += 1) {
      if (!before[i] || !before[i].locked) {
        continue;
      }
      if (i >= after.length || !after[i] || after[i].id !== before[i].id) {
        return false;
      }
    }
    return true;
  }

  function canTransformLayer(layer) {
    return Boolean(layer && !layer.locked);
  }

  function canMoveLayer(layers, index, delta) {
    if (!Array.isArray(layers) || index < 0 || index >= layers.length) {
      return false;
    }
    if (layers[index].locked) {
      return false;
    }
    const target = index + delta;
    if (target < 0 || target >= layers.length) {
      return false;
    }
    if (layers[target].locked) {
      return false;
    }
    return true;
  }

  function moveLayer(layers, index, delta) {
    if (!canMoveLayer(layers, index, delta)) {
      return layers.slice();
    }
    const copy = layers.slice();
    const target = index + delta;
    const moving = copy[index];
    copy[index] = copy[target];
    copy[target] = moving;
    return copy;
  }

  function canRemoveLayer(layers, index) {
    if (!Array.isArray(layers) || index < 0 || index >= layers.length) {
      return false;
    }
    if (layers[index].locked) {
      return false;
    }
    for (let i = index + 1; i < layers.length; i += 1) {
      if (layers[i].locked) {
        return false;
      }
    }
    return true;
  }

  function toggleLock(layers, index) {
    if (!Array.isArray(layers) || index < 0 || index >= layers.length) {
      return layers.slice();
    }
    const copy = layers.slice();
    copy[index] = Object.assign({}, copy[index], { locked: !copy[index].locked });
    return copy;
  }

  function toggleVisibility(layers, index) {
    if (!Array.isArray(layers) || index < 0 || index >= layers.length) {
      return layers.slice();
    }
    const copy = layers.slice();
    copy[index] = Object.assign({}, copy[index], { visible: !copy[index].visible });
    return copy;
  }

  function removeLayer(layers, index) {
    if (!canRemoveLayer(layers, index)) {
      return layers.slice();
    }
    const copy = layers.slice();
    copy.splice(index, 1);
    return copy;
  }

  function addLayer(layers, type, id) {
    const list = Array.isArray(layers) ? layers.slice() : [];
    list.push(createLayer(type, id));
    return list;
  }

  function dragLayerBounds(layer, dx, dy) {
    if (!canTransformLayer(layer)) {
      return layer && typeof layer === "object" ? Object.assign({}, layer) : layer;
    }
    const bounds = layerBounds(layer);
    return Object.assign({}, layer, {
      bounds: clampBounds({
        x: bounds.x + dx,
        y: bounds.y + dy,
        w: bounds.w,
        h: bounds.h,
      }),
    });
  }

  function resizeLayerBounds(layer, dw, dh) {
    if (!canTransformLayer(layer)) {
      return layer && typeof layer === "object" ? Object.assign({}, layer) : layer;
    }
    const bounds = layerBounds(layer);
    return Object.assign({}, layer, {
      bounds: clampBounds({
        x: bounds.x,
        y: bounds.y,
        w: bounds.w + dw,
        h: bounds.h + dh,
      }),
    });
  }

  function visibleLayersForStage(layers) {
    if (!Array.isArray(layers)) {
      return [];
    }
    const visible = [];
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      if (layers[i].visible) {
        visible.push(layers[i]);
      }
    }
    return visible;
  }

  function evaluateLayout(layers) {
    const list = Array.isArray(layers) ? layers : [];
    const checks = [];

    const captionsIdx = list.findIndex((layer) => layer.type === "captions" && layer.visible);
    const speakerIdx = list.findIndex((layer) => layer.type === "speaker" && layer.visible);
    if (captionsIdx >= 0 && speakerIdx >= 0 && speakerIdx < captionsIdx) {
      checks.push({
        title: "Captions may be covered",
        action: "A speaker frame sits above the captions. Move captions higher in the stack so they stay readable.",
        tone: "review",
      });
    }

    list.forEach((layer) => {
      const meta = getLayerType(layer.type);
      if (meta.brand && layer.visible && !layer.locked) {
        checks.push({
          title: "Brand element is unlocked",
          action: "Lock the logo or show branding so its stack position cannot move by accident while editing.",
          tone: "review",
        });
      }
    });

    const hiddenSpeakers = list.filter((layer) => layer.type === "speaker" && !layer.visible).length;
    if (hiddenSpeakers > 0) {
      checks.push({
        title: `${hiddenSpeakers} speaker frame${hiddenSpeakers === 1 ? "" : "s"} hidden`,
        action: "A hidden speaker will not appear in this layout. Show the frame or confirm they are audio-only.",
        tone: "info",
      });
    }

    const hasReview = checks.some((check) => check.tone === "review");
    return { checks, overall: hasReview ? "review" : "ready" };
  }

  const api = {
    LAYER_TYPES,
    DEFAULT_BOUNDS,
    getLayerType,
    defaultBoundsForType,
    clampBounds,
    layerBounds,
    createLayer,
    sampleLayers,
    layerIndex,
    preservesLockedStackPositions,
    canTransformLayer,
    canMoveLayer,
    moveLayer,
    canRemoveLayer,
    toggleLock,
    toggleVisibility,
    removeLayer,
    addLayer,
    dragLayerBounds,
    resizeLayerBounds,
    visibleLayersForStage,
    evaluateLayout,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcCanvasLayers = api;
}(typeof window !== "undefined" ? window : globalThis));
