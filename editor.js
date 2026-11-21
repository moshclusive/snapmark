/**
 * Snapmark Studio - Adobe Illustrator Dark Theme & Precision Editing Suite
 * Pixel-perfect sharp rendering, transparent text selection layer for instant Ctrl+C,
 * reliable inline text typing, 1-click Photoshop artboard paste, and instant ESC clear.
 */

import { buildPdf, buildPsd } from "./shared.js";

const CAPTURE_KEY = "snapmark_current_capture";

// DOM Elements
const captureImg = document.getElementById("capture-img");
const stage = document.getElementById("stage");
const textLayer = document.getElementById("text-layer");
const drawCanvas = document.getElementById("draw-canvas");
const ctx = drawCanvas.getContext("2d");
const frameWrapper = document.getElementById("frame-wrapper");
const frameScaler = document.getElementById("frame-scaler");
const canvasScroll = document.getElementById("canvas-scroll");

// Topbar Controls
const docTitleInput = document.getElementById("doc-title-input");
const docDimensionsBadge = document.getElementById("doc-dimensions-badge");
const btnExtractTextEditor = document.getElementById("btn-extract-text-editor");
const btnCopyClipboard = document.getElementById("btn-copy-clipboard");
const btnSaveImage = document.getElementById("btn-save-image");
const menuSaveImage = document.getElementById("menu-save-image");
const btnSavePdf = document.getElementById("btn-save-pdf");
const btnPrint = document.getElementById("btn-print");
const btnZoomIn = document.getElementById("btn-zoom-in");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnZoomFit = document.getElementById("btn-zoom-fit");
const zoomLabel = document.getElementById("zoom-label");

// Adobe-Style Tooltip & Swatch Box
const adobeTooltip = document.getElementById("adobe-tooltip");
const tipText = document.getElementById("tip-text");
const tipKbd = document.getElementById("tip-kbd");
const swatchIndicator = document.getElementById("swatch-indicator");

// Toolbar & Tools
const toolbar = document.getElementById("toolbar");
const btnUndo = document.getElementById("btn-undo");
const btnRedo = document.getElementById("btn-redo");
const btnClearAll = document.getElementById("btn-clear-all");
const colorCustom = document.getElementById("color-custom");
const colorDots = document.querySelectorAll(".color-dot");
const strokeOpts = document.querySelectorAll(".stroke-opt");

// Toast & Confirmation Modal
const toast = document.getElementById("toast");
const confirmModal = document.getElementById("confirm-modal");
const modalTitle = document.getElementById("modal-title");
const modalDesc = document.getElementById("modal-desc");
const modalOkBtn = document.getElementById("modal-ok-btn");
const modalCancelBtn = document.getElementById("modal-cancel-btn");

// State
let rawWidth = 0;
let rawHeight = 0;
let pageUrl = "";
let pageTitle = "Capture";
let zoom = 1;
let activeTool = "pen";
let currentColor = "#ef4444";
let currentWidth = 4; // Default size 4pt/4px

// Annotations & History
const annotations = [];
const undoStack = [];
const redoStack = [];
let selectedItem = null;
let currentDrawing = null;
let isDrawing = false;
let isDraggingItem = false;
let dragStartX = 0;
let dragStartY = 0;
let nextBadgeNumber = 1;

function cloneAnnotations(list) {
  return list.map((item) => ({
    ...item,
    points: item.points ? item.points.map((p) => [p[0], p[1]]) : undefined,
    ctrl: item.ctrl ? { ...item.ctrl } : undefined,
  }));
}

function pushHistory() {
  undoStack.push(cloneAnnotations(annotations));
  redoStack.length = 0;
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(cloneAnnotations(annotations));
  const prev = undoStack.pop();
  annotations.length = 0;
  annotations.push(...prev);
  selectedItem = null;
  renderCanvas();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(cloneAnnotations(annotations));
  const next = redoStack.pop();
  annotations.length = 0;
  annotations.push(...next);
  selectedItem = null;
  renderCanvas();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

/**
 * Initialize Editor from chrome.storage or demo mode
 */
async function initEditor() {
  let data = null;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      data = (await chrome.storage.local.get(CAPTURE_KEY))[CAPTURE_KEY];
    } catch {}
  }

  // Support demo preview mode (?demo=1) for testing without taking a live screenshot
  if (!data && new URLSearchParams(window.location.search).get("demo")) {
    const demoCanvas = document.createElement("canvas");
    demoCanvas.width = 1350;
    demoCanvas.height = 800;
    const dctx = demoCanvas.getContext("2d");
    dctx.fillStyle = "#ffffff";
    dctx.fillRect(0, 0, 1350, 800);
    dctx.fillStyle = "#0f172a";
    dctx.font = "bold 36px -apple-system, sans-serif";
    dctx.fillText("Snapmark Studio - Best Quality Preview", 60, 90);
    dctx.fillStyle = "#64748b";
    dctx.font = "18px -apple-system, sans-serif";
    dctx.fillText("100% native pixel crispness, Illustrator Dark appearance, selectable screenshot text, and instant ESC clear.", 60, 130);

    // Sample card
    dctx.fillStyle = "#f8fafc";
    dctx.strokeStyle = "#e2e8f0";
    dctx.lineWidth = 2;
    dctx.beginPath();
    dctx.roundRect(60, 180, 540, 260, 12);
    dctx.fill();
    dctx.stroke();

    dctx.fillStyle = "#1e293b";
    dctx.font = "bold 20px -apple-system, sans-serif";
    dctx.fillText("Feature Highlights", 90, 230);
    dctx.font = "15px -apple-system, sans-serif";
    dctx.fillStyle = "#475569";
    dctx.fillText("• 100% Native High Resolution: zero blur or downscaling artifacts", 90, 270);
    dctx.fillText("• Press ESC: instantly clears all drawings/annotations", 90, 305);
    dctx.fillText("• Text Tool: write clean text notes anywhere by clicking", 90, 340);
    dctx.fillText("• Photoshop: 1-click copy directly to paste on Photoshop artboard", 90, 375);

    data = {
      imageDataUrl: demoCanvas.toDataURL("image/png"),
      canvasWidth: 1350,
      canvasHeight: 800,
      pageTitle: "Snapmark Demo Preview",
      pageUrl: "https://snapmark.studio",
      dpr: 1,
      textNodes: [
        { text: "Snapmark Studio - Best Quality Preview", x: 60, y: 60, w: 700, h: 40 },
        { text: "100% Native High Resolution: zero blur or downscaling artifacts", x: 90, y: 255, w: 500, h: 22 },
        { text: "Press ESC: instantly clears all drawings/annotations", x: 90, y: 290, w: 450, h: 22 },
        { text: "Text Tool: write clean text notes anywhere by clicking", x: 90, y: 325, w: 450, h: 22 },
      ],
    };
  }

  if (!data) {
    document.body.innerHTML = `
      <div style="padding:60px 20px; text-align:center; color:#a1a1aa; font-family:-apple-system, sans-serif; background:#1e1e1e; height:100vh;">
        <h2 style="color:#ffffff; margin-bottom:12px;">No Screenshot Found</h2>
        <p style="margin-bottom:24px;">Please open a webpage and take a screenshot using the Snapmark extension icon.</p>
        <a href="editor.html?demo=1" style="display:inline-block; background:#6366f1; color:#fff; padding:10px 22px; border-radius:8px; text-decoration:none; font-weight:600;">Open Studio Demo Preview</a>
      </div>
    `;
    return;
  }

  rawWidth = data.canvasWidth;
  rawHeight = data.canvasHeight;
  pageUrl = data.pageUrl || "";
  pageTitle = data.pageTitle || "Screenshot";

  docTitleInput.value = pageTitle;
  document.title = `${pageTitle} - Snapmark Studio`;

  const onImageReady = () => {
    updateDimensions();
    fitToWidth();
    renderTextLayer(data.textNodes, data.dpr || 1);
    updateToolState();
    renderCanvas();
  };

  captureImg.onload = onImageReady;
  captureImg.onerror = (err) => {
    console.error("[Snapmark Studio] Failed to load screenshot image data:", err);
  };
  captureImg.src = data.imageDataUrl;
  if (captureImg.complete && captureImg.naturalWidth > 0) {
    onImageReady();
  }
}

/**
 * Native 1:1 Pixel Dimensions (Zero Downscaling Blur)
 */
function updateDimensions() {
  captureImg.style.width = `${rawWidth}px`;
  captureImg.style.height = `${rawHeight}px`;
  stage.style.width = `${rawWidth}px`;
  stage.style.height = `${rawHeight}px`;
  frameWrapper.style.width = `${rawWidth}px`;

  drawCanvas.width = rawWidth;
  drawCanvas.height = rawHeight;
  drawCanvas.style.width = `${rawWidth}px`;
  drawCanvas.style.height = `${rawHeight}px`;

  docDimensionsBadge.textContent = `${rawWidth} × ${rawHeight} px`;
}

/**
 * Fits screenshot width to editing window perfectly without horizontal scrollbar (100% view if small)
 */
function fitToWidth() {
  // Available width accounting for left toolbar (46px at left 14px) and right padding
  const availableWidth = Math.max(300, canvasScroll.clientWidth - 110);
  if (rawWidth <= availableWidth) {
    zoom = 1; // 100% native view
  } else {
    zoom = availableWidth / rawWidth; // Perfectly fits width with zero horizontal overflow
  }
  applyZoom();
}

function applyZoom() {
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  frameWrapper.style.transform = `scale(${zoom})`;
  frameWrapper.style.transformOrigin = "top left";
  if (frameScaler) {
    frameScaler.style.width = `${Math.round(rawWidth * zoom)}px`;
    frameScaler.style.height = `${Math.round(rawHeight * zoom)}px`;
  }
}


/**
 * Render selectable transparent text spans over screenshot
 * Enables native mouse drag selection & Ctrl+C copy of text from the screenshot
 */
function renderTextLayer(nodes, dpr = 1) {
  if (!textLayer) return;
  textLayer.innerHTML = "";
  if (!nodes || !nodes.length) return;

  const frag = document.createDocumentFragment();
  nodes.forEach((n) => {
    if (!n.text || !n.text.trim()) return;
    const span = document.createElement("span");
    span.className = "selectable-text-token";
    span.textContent = n.text;

    const left = Math.round(n.x * dpr);
    const top = Math.round(n.y * dpr);
    const width = Math.round(n.w * dpr);
    const height = Math.round(n.h * dpr);

    span.style.left = `${left}px`;
    span.style.top = `${top}px`;
    span.style.width = `${width}px`;
    span.style.height = `${height}px`;
    span.style.fontSize = `${Math.max(10, Math.round(height * 0.82))}px`;
    span.style.lineHeight = `${height}px`;

    frag.appendChild(span);
  });
  textLayer.appendChild(frag);
}

/**
 * Canvas Rendering Pipeline
 * Unified single-pass spotlight & crisp vector drawing
 */
function renderCanvas() {
  ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

  const nonSpotlights = [];
  const spotlights = [];

  annotations.forEach((item) => {
    if (item.hidden) return;
    if (item.type === "spotlight") {
      spotlights.push(item);
    } else {
      nonSpotlights.push(item);
    }
  });

  if (currentDrawing && currentDrawing.type === "spotlight") {
    spotlights.push(currentDrawing);
  }

  // 1. Draw unified spotlight mask if any spotlight exists
  if (spotlights.length > 0) {
    renderUnifiedSpotlights(ctx, spotlights, drawCanvas.width, drawCanvas.height);
  }

  // 2. Draw non-spotlight annotations
  nonSpotlights.forEach((item) => {
    drawAnnotation(ctx, item);
  });

  // 3. Draw live non-spotlight drawing
  if (currentDrawing && currentDrawing.type !== "spotlight") {
    drawAnnotation(ctx, currentDrawing);
  }

  // 4. Highlight selected item bounding box
  if (selectedItem && activeTool === "select") {
    drawSelectionBox(ctx, selectedItem);
  }
}

/**
 * Unified Spotlight Rendering
 * Cuts out all spotlight regions simultaneously with a single 55% dark mask
 */
function renderUnifiedSpotlights(targetCtx, spotlights, width, height) {
  if (!spotlights || !spotlights.length) return;

  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(0, 0, width, height);

  spotlights.forEach((spot) => {
    const sx = Math.min(spot.x1, spot.x2);
    const sy = Math.min(spot.y1, spot.y2);
    const sw = Math.abs(spot.x2 - spot.x1);
    const sh = Math.abs(spot.y2 - spot.y1);
    if (sw > 0 && sh > 0) {
      targetCtx.rect(sx, sy, sw, sh);
    }
  });

  targetCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
  targetCtx.fill("evenodd");

  // Subtle clean highlight borders around each spotlight
  spotlights.forEach((spot) => {
    const sx = Math.min(spot.x1, spot.x2);
    const sy = Math.min(spot.y1, spot.y2);
    const sw = Math.abs(spot.x2 - spot.x1);
    const sh = Math.abs(spot.y2 - spot.y1);
    if (sw > 0 && sh > 0) {
      targetCtx.strokeStyle = "rgba(56, 189, 248, 0.9)";
      targetCtx.lineWidth = 1.5;
      targetCtx.strokeRect(sx, sy, sw, sh);
    }
  });

  targetCtx.restore();
}

/**
 * Draws an individual annotation item
 */
function drawAnnotation(targetCtx, item) {
  targetCtx.save();
  targetCtx.strokeStyle = item.color;
  targetCtx.fillStyle = item.color;
  targetCtx.lineWidth = item.width || currentWidth;
  targetCtx.lineCap = item.type === "highlighter" ? "square" : "round";
  targetCtx.lineJoin = "round";

  switch (item.type) {
    case "pen":
      if (item.points && item.points.length > 1) {
        targetCtx.beginPath();
        item.points.forEach(([x, y], i) => {
          if (i === 0) targetCtx.moveTo(x, y);
          else targetCtx.lineTo(x, y);
        });
        targetCtx.stroke();
      }
      break;

    case "highlighter":
      if (item.points && item.points.length > 1) {
        targetCtx.save();
        targetCtx.globalAlpha = 0.38;
        targetCtx.lineWidth = (item.width || currentWidth) * 4;
        targetCtx.beginPath();
        item.points.forEach(([x, y], i) => {
          if (i === 0) targetCtx.moveTo(x, y);
          else targetCtx.lineTo(x, y);
        });
        targetCtx.stroke();
        targetCtx.restore();
      }
      break;

    case "rect-stroke": {
      const x = Math.min(item.x1, item.x2);
      const y = Math.min(item.y1, item.y2);
      const w = Math.abs(item.x2 - item.x1);
      const h = Math.abs(item.y2 - item.y1);
      targetCtx.strokeRect(x, y, w, h);
      break;
    }

    case "ellipse-stroke": {
      const cx = (item.x1 + item.x2) / 2;
      const cy = (item.y1 + item.y2) / 2;
      const rx = Math.abs(item.x2 - item.x1) / 2;
      const ry = Math.abs(item.y2 - item.y1) / 2;
      targetCtx.beginPath();
      targetCtx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      targetCtx.stroke();
      break;
    }

    case "line-solid": {
      targetCtx.beginPath();
      targetCtx.moveTo(item.x1, item.y1);
      targetCtx.lineTo(item.x2, item.y2);
      targetCtx.stroke();
      break;
    }

    case "arrow-single": {
      targetCtx.beginPath();
      targetCtx.moveTo(item.x1, item.y1);
      targetCtx.lineTo(item.x2, item.y2);
      targetCtx.stroke();

      const dx = item.x2 - item.x1;
      const dy = item.y2 - item.y1;
      drawArrowHead(targetCtx, item.x2, item.y2, Math.atan2(dy, dx), item.width || currentWidth);
      break;
    }

    case "number-badge": {
      const r = item.radius || 15;
      targetCtx.beginPath();
      targetCtx.arc(item.x, item.y, r, 0, Math.PI * 2);
      targetCtx.fill();

      // Contrasting number text
      targetCtx.fillStyle = getContrastColor(item.color);
      targetCtx.font = `bold ${Math.round(r * 1.2)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      targetCtx.textAlign = "center";
      targetCtx.textBaseline = "middle";
      targetCtx.fillText(String(item.number), item.x, item.y + 1);
      break;
    }

    case "blur-redact": {
      const bx = Math.min(item.x1, item.x2);
      const by = Math.min(item.y1, item.y2);
      const bw = Math.abs(item.x2 - item.x1);
      const bh = Math.abs(item.y2 - item.y1);
      if (bw > 2 && bh > 2) {
        applyPixelateBlur(targetCtx, bx, by, bw, bh);
      }
      break;
    }

    case "add-text": {
      const fontSize = item.fontSize || 20;
      targetCtx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      targetCtx.textBaseline = "top";
      targetCtx.textAlign = "left";

      const lines = String(item.text).split("\n");

      // Crisp colored text with zero background
      targetCtx.fillStyle = item.color || "#ffffff";
      lines.forEach((l, i) => {
        targetCtx.fillText(l, item.x, item.y + i * fontSize * 1.35);
      });
      break;
    }
  }

  targetCtx.restore();
}

function drawArrowHead(c, x, y, angle, strokeW) {
  const headLen = Math.max(12, strokeW * 3.5);
  c.save();
  c.beginPath();
  c.translate(x, y);
  c.rotate(angle);
  c.moveTo(0, 0);
  c.lineTo(-headLen, -headLen * 0.45);
  c.lineTo(-headLen * 0.7, 0);
  c.lineTo(-headLen, headLen * 0.45);
  c.closePath();
  c.fill();
  c.restore();
}

function getContrastColor(hex) {
  if (!hex || !hex.startsWith("#")) return "#ffffff";
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0f172a" : "#ffffff";
}

function applyPixelateBlur(c, x, y, w, h) {
  const pixelSize = 10;
  const smallW = Math.max(1, Math.floor(w / pixelSize));
  const smallH = Math.max(1, Math.floor(h / pixelSize));

  const offCanvas = document.createElement("canvas");
  offCanvas.width = smallW;
  offCanvas.height = smallH;
  const offCtx = offCanvas.getContext("2d");
  offCtx.imageSmoothingEnabled = false;

  offCtx.drawImage(captureImg, x, y, w, h, 0, 0, smallW, smallH);

  c.save();
  c.imageSmoothingEnabled = false;
  c.drawImage(offCanvas, 0, 0, smallW, smallH, x, y, w, h);
  c.restore();
}

function drawSelectionBox(c, item) {
  const bounds = getItemBounds(item);
  c.save();
  c.strokeStyle = "#6366f1";
  c.lineWidth = 1.5;
  c.setLineDash([5, 3]);
  c.strokeRect(bounds.x - 4, bounds.y - 4, bounds.w + 8, bounds.h + 8);

  // Corner resize / move handles
  c.fillStyle = "#ffffff";
  c.strokeStyle = "#6366f1";
  c.lineWidth = 1.5;
  c.setLineDash([]);
  const hs = 6;
  const corners = [
    [bounds.x - 4, bounds.y - 4],
    [bounds.x + bounds.w + 4, bounds.y - 4],
    [bounds.x - 4, bounds.y + bounds.h + 4],
    [bounds.x + bounds.w + 4, bounds.y + bounds.h + 4],
  ];
  corners.forEach(([cx, cy]) => {
    c.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    c.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
  });
  c.restore();
}

function getItemBounds(item) {
  if (item.points && item.points.length) {
    const xs = item.points.map((p) => p[0]);
    const ys = item.points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (item.type === "number-badge") {
    const r = item.radius || 15;
    return { x: item.x - r, y: item.y - r, w: r * 2, h: r * 2 };
  }
  if (item.type === "add-text") {
    const fontSize = item.fontSize || 20;
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const lines = String(item.text).split("\n");
    let maxW = 0;
    lines.forEach((l) => {
      const m = ctx.measureText(l);
      if (m.width > maxW) maxW = m.width;
    });
    const totalH = lines.length * fontSize * 1.35;
    return { x: item.x, y: item.y, w: Math.max(20, maxW), h: Math.max(16, totalH) };
  }
  const minX = Math.min(item.x1, item.x2);
  const maxX = Math.max(item.x1, item.x2);
  const minY = Math.min(item.y1, item.y2);
  const maxY = Math.max(item.y1, item.y2);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function isPointInItem(px, py, item) {
  const b = getItemBounds(item);
  const margin = 14; // Generous margin for easy clicking and moving
  return px >= b.x - margin && px <= b.x + b.w + margin && py >= b.y - margin && py <= b.y + b.h + margin;
}

/**
 * Move / Drag Annotation Helper
 */
function moveItem(item, dx, dy) {
  if (item.points && item.points.length) {
    item.points.forEach((p) => {
      p[0] += dx;
      p[1] += dy;
    });
    return;
  }
  if (item.type === "number-badge" || item.type === "add-text") {
    item.x += dx;
    item.y += dy;
    return;
  }
  if (item.x1 !== undefined && item.y1 !== undefined) {
    item.x1 += dx;
    item.y1 += dy;
    item.x2 += dx;
    item.y2 += dy;
    if (item.ctrl) {
      item.ctrl.x += dx;
      item.ctrl.y += dy;
    }
  }
}

/**
 * Canvas Mouse / Pointer Events
 */
function getCanvasCoords(e) {
  const rect = stage.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / zoom,
    y: (e.clientY - rect.top) / zoom,
  };
}

drawCanvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const { x, y } = getCanvasCoords(e);

  if (activeTool === "select") {
    const clicked = [...annotations].reverse().find((item) => !item.hidden && isPointInItem(x, y, item));
    selectedItem = clicked || null;
    if (selectedItem) {
      currentColor = selectedItem.color;
      updateColorUI();
      isDraggingItem = true;
      dragStartX = x;
      dragStartY = y;
      drawCanvas.setPointerCapture(e.pointerId);
      drawCanvas.style.cursor = "grabbing";
    } else {
      // User clicked outside items: temporarily allow transparent text selection on textLayer
      drawCanvas.style.pointerEvents = "none";
      const restorePointer = () => {
        drawCanvas.style.pointerEvents = "auto";
        window.removeEventListener("pointerup", restorePointer);
      };
      window.addEventListener("pointerup", restorePointer);
    }
    renderCanvas();
    return;
  }

  if (activeTool === "eraser") {
    const targetIdx = annotations.findIndex((item) => !item.hidden && isPointInItem(x, y, item));
    if (targetIdx !== -1) {
      pushHistory();
      annotations.splice(targetIdx, 1);
      renderCanvas();
    }
    return;
  }

  if (activeTool === "number-badge") {
    pushHistory();
    annotations.push({
      type: "number-badge",
      x,
      y,
      number: nextBadgeNumber++,
      radius: Math.max(12, currentWidth * 4),
      color: currentColor,
    });
    renderCanvas();
    return;
  }

  if (activeTool === "add-text") {
    openInlineTextInput(x, y);
    return;
  }

  // Drawing tools: Pen, Highlighter, Shapes, Arrows, Blur, Spotlight
  isDrawing = true;
  drawCanvas.setPointerCapture(e.pointerId);

  if (activeTool === "pen" || activeTool === "highlighter") {
    currentDrawing = {
      type: activeTool,
      color: currentColor,
      width: currentWidth,
      points: [[x, y]],
    };
  } else {
    currentDrawing = {
      type: activeTool,
      color: currentColor,
      width: currentWidth,
      x1: x,
      y1: y,
      x2: x,
      y2: y,
    };
  }
});

drawCanvas.addEventListener("pointermove", (e) => {
  const { x, y } = getCanvasCoords(e);

  if (activeTool === "select" && !isDraggingItem) {
    const hoveredItem = annotations.find((item) => !item.hidden && isPointInItem(x, y, item));
    drawCanvas.style.cursor = hoveredItem ? "move" : "default";
  }

  if (isDraggingItem && selectedItem) {
    const dx = x - dragStartX;
    const dy = y - dragStartY;
    moveItem(selectedItem, dx, dy);
    dragStartX = x;
    dragStartY = y;
    renderCanvas();
    return;
  }

  if (!isDrawing || !currentDrawing) return;

  if (currentDrawing.type === "pen" || currentDrawing.type === "highlighter") {
    currentDrawing.points.push([x, y]);
  } else {
    if (e.shiftKey) {
      const dx = x - currentDrawing.x1;
      const dy = y - currentDrawing.y1;
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      currentDrawing.x2 = currentDrawing.x1 + Math.sign(dx) * side;
      currentDrawing.y2 = currentDrawing.y1 + Math.sign(dy) * side;
    } else {
      currentDrawing.x2 = x;
      currentDrawing.y2 = y;
    }
  }

  renderCanvas();
});

drawCanvas.addEventListener("pointerup", (e) => {
  if (isDraggingItem) {
    isDraggingItem = false;
    try {
      drawCanvas.releasePointerCapture(e.pointerId);
    } catch {}
    drawCanvas.style.cursor = "default";
    pushHistory();
    return;
  }

  if (!isDrawing) return;
  isDrawing = false;
  try {
    drawCanvas.releasePointerCapture(e.pointerId);
  } catch {}

  if (!currentDrawing) return;

  pushHistory();
  annotations.push(currentDrawing);
  currentDrawing = null;
  renderCanvas();
});

/**
 * Inline Text Input for Text Tool
 * Stops event bubbling, scales inversely with zoom for perfect legibility,
 * and includes Done/Cancel buttons so text is NEVER lost.
 */
function openInlineTextInput(x, y) {
  // Commit any currently open input first
  const existingBox = document.querySelector(".inline-text-box");
  if (existingBox) {
    const saveBtn = existingBox.querySelector(".save-btn");
    if (saveBtn) saveBtn.click();
    else existingBox.remove();
  }

  // Calculate font size that visually appears comfortable on screen regardless of zoom
  const visualFontSize = Math.max(16, currentWidth * 5); // 16px - 28px
  const stageFontSize = Math.round(visualFontSize / zoom);
  const stageBoxWidth = Math.round(260 / zoom);
  const stageMinHeight = Math.round(44 / zoom);

  const box = document.createElement("div");
  box.className = "inline-text-box";
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${stageBoxWidth}px`;

  const input = document.createElement("textarea");
  input.className = "inline-text-input";
  input.placeholder = "Type text here...";
  input.style.color = currentColor || "#ffffff";
  input.style.fontSize = `${stageFontSize}px`;
  input.style.minHeight = `${stageMinHeight}px`;

  const actions = document.createElement("div");
  actions.className = "inline-text-actions";

  const btnDone = document.createElement("button");
  btnDone.className = "inline-text-btn save-btn";
  btnDone.textContent = "✔ Done";
  btnDone.title = "Add Text (Enter)";

  const btnCancel = document.createElement("button");
  btnCancel.className = "inline-text-btn cancel-btn";
  btnCancel.textContent = "✖ Cancel";
  btnCancel.title = "Cancel (Esc)";

  actions.appendChild(btnCancel);
  actions.appendChild(btnDone);

  box.appendChild(input);
  box.appendChild(actions);

  // Stop pointer events from bubbling to canvas or stage
  ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"].forEach((evt) => {
    box.addEventListener(evt, (e) => e.stopPropagation());
  });

  stage.appendChild(box);

  // Auto-resize as user types
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.max(stageMinHeight, input.scrollHeight)}px`;
  });

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const txt = input.value.trim();
    if (txt) {
      pushHistory();
      annotations.push({
        type: "add-text",
        x,
        y,
        text: txt,
        color: currentColor || "#ffffff",
        fontSize: stageFontSize,
      });
      renderCanvas();
      showToast("Text added!");
    }
    box.remove();
  };

  btnDone.addEventListener("click", (e) => {
    e.stopPropagation();
    commit();
  });

  btnCancel.addEventListener("click", (e) => {
    e.stopPropagation();
    committed = true;
    box.remove();
  });

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      committed = true;
      box.remove();
    }
  });

  setTimeout(() => {
    input.focus();
  }, 40);
}

/**
 * Tool Switching & Selection
 */
function updateToolState() {
  const isSelect = activeTool === "select";
  drawCanvas.style.pointerEvents = "auto";
  drawCanvas.style.cursor = isSelect ? "default" : activeTool === "add-text" ? "text" : "crosshair";
  stage.style.cursor = "default";
}

function selectTool(toolName) {
  activeTool = toolName;
  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tool === toolName);
  });

  if (toolName !== "select") {
    selectedItem = null;
  }
  updateToolState();
  renderCanvas();
}

toolbar.addEventListener("click", (e) => {
  const btn = e.target.closest(".tool-btn");
  if (!btn) return;
  const tool = btn.dataset.tool;
  if (tool) {
    selectTool(tool);
  }
});

/**
 * Color Palette & Stroke Controls
 */
function updateColorUI() {
  colorDots.forEach((d) => d.classList.toggle("active", d.dataset.color.toLowerCase() === currentColor.toLowerCase()));
  colorCustom.value = currentColor;
  if (swatchIndicator) {
    swatchIndicator.style.background = currentColor;
  }
}

colorDots.forEach((dot) => {
  dot.addEventListener("click", () => {
    currentColor = dot.dataset.color;
    updateColorUI();
    if (selectedItem) {
      pushHistory();
      selectedItem.color = currentColor;
      renderCanvas();
    }
  });
});

colorCustom.addEventListener("input", (e) => {
  currentColor = e.target.value;
  updateColorUI();
  if (selectedItem) {
    selectedItem.color = currentColor;
    renderCanvas();
  }
});

strokeOpts.forEach((opt) => {
  opt.addEventListener("click", () => {
    strokeOpts.forEach((o) => o.classList.remove("active"));
    opt.classList.add("active");
    currentWidth = parseInt(opt.dataset.width, 10);
  });
});

/**
 * Instant Floating Tooltips
 */
function initAdobeTooltips() {
  if (!adobeTooltip || !tipText) return;

  function handleEnter(e) {
    const el = e.currentTarget;
    const title = el.getAttribute("data-tip-title");
    const key = el.getAttribute("data-tip-key");
    if (!title) return;

    tipText.textContent = title;
    if (key) {
      tipKbd.textContent = key;
      tipKbd.style.display = "inline-block";
    } else {
      tipKbd.style.display = "none";
    }

    adobeTooltip.classList.remove("hidden");
    const rect = el.getBoundingClientRect();
    const tipRect = adobeTooltip.getBoundingClientRect();

    if (rect.left < 120) {
      adobeTooltip.style.left = `${rect.right + 10}px`;
      adobeTooltip.style.top = `${rect.top + (rect.height - tipRect.height) / 2}px`;
    } else {
      adobeTooltip.style.left = `${Math.max(10, rect.left + (rect.width - tipRect.width) / 2)}px`;
      adobeTooltip.style.top = `${rect.bottom + 8}px`;
    }
  }

  function handleLeave() {
    adobeTooltip.classList.add("hidden");
  }

  document.querySelectorAll("[data-tip-title]").forEach((el) => {
    el.addEventListener("pointerenter", handleEnter);
    el.addEventListener("pointerleave", handleLeave);
  });
}

/**
 * Clear All Modal
 */
btnClearAll.addEventListener("click", () => {
  if (!annotations.length) return;
  modalTitle.textContent = "Clear All Annotations";
  modalDesc.textContent = "Are you sure you want to remove all drawings and marks from this screenshot?";
  confirmModal.classList.remove("hidden");
});

modalCancelBtn.addEventListener("click", () => confirmModal.classList.add("hidden"));

modalOkBtn.addEventListener("click", () => {
  pushHistory();
  annotations.length = 0;
  selectedItem = null;
  confirmModal.classList.add("hidden");
  renderCanvas();
  showToast("All annotations cleared.");
});

/**
 * Composite Final Canvas (Native 1:1 Pixel Resolution)
 */
function getCompositeCanvas() {
  const outCanvas = document.createElement("canvas");
  outCanvas.width = rawWidth;
  outCanvas.height = rawHeight;
  const outCtx = outCanvas.getContext("2d");

  // Draw base screenshot at 100% resolution
  outCtx.drawImage(captureImg, 0, 0, rawWidth, rawHeight);

  // Render annotations at 100% resolution
  const spotlights = annotations.filter((a) => !a.hidden && a.type === "spotlight");
  const nonSpotlights = annotations.filter((a) => !a.hidden && a.type !== "spotlight");

  if (spotlights.length > 0) {
    renderUnifiedSpotlights(outCtx, spotlights, rawWidth, rawHeight);
  }

  nonSpotlights.forEach((item) => {
    drawAnnotation(outCtx, item);
  });

  return outCanvas;
}

/**
 * Extract Text (AI OCR) from current canvas screenshot
 */
btnExtractTextEditor?.addEventListener("click", () => {
  const canvas = getCompositeCanvas();
  const dataUrl = canvas.toDataURL("image/png");

  // Save loading state to chrome.storage.local
  chrome.storage.local.set({
    snapmark_active_ocr: {
      status: "loading",
      imageDataUrl: dataUrl,
      text: "",
      lang: "detect",
      timestamp: Date.now(),
    },
  });

  // Inject or re-inject ocr-modal.js into the editor window
  const existingScript = document.getElementById("snapmark-ocr-injected-script");
  if (existingScript) existingScript.remove();
  const script = document.createElement("script");
  script.id = "snapmark-ocr-injected-script";
  script.src = chrome.runtime.getURL("ocr-modal.js");
  document.body.appendChild(script);

  // Trigger OCR processing in background
  chrome.runtime.sendMessage({
    action: "ocr-process-custom-image",
    dataUrl,
    lang: "detect",
  });
});

/**
 * Export: Copy to Clipboard
 */
btnCopyClipboard.addEventListener("click", async () => {
  // If user has highlighted text on the screenshot, copy the text!
  const textSel = window.getSelection()?.toString();
  if (textSel && textSel.trim()) {
    try {
      await navigator.clipboard.writeText(textSel);
      showToast("Selected text copied to clipboard!");
      return;
    } catch {}
  }

  const canvas = getCompositeCanvas();
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("Screenshot copied to clipboard! (Ctrl+V to paste)");
    } catch {
      showToast("Clipboard copy failed. Try Save Image.");
    }
  }, "image/png");
});

/**
 * Export: Save Image Dropdown (Only PNG, JPG, PDF)
 */
btnSaveImage.addEventListener("click", (e) => {
  e.stopPropagation();
  menuSaveImage.classList.toggle("hidden");
});

document.addEventListener("click", () => menuSaveImage.classList.add("hidden"));

menuSaveImage.addEventListener("click", async (e) => {
  const item = e.target.closest(".menu-item");
  if (!item) return;
  const format = item.dataset.format;
  menuSaveImage.classList.add("hidden");

  if (format === "pdf") {
    btnSavePdf.click();
    return;
  }

  const canvas = getCompositeCanvas();
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  const ext = format === "jpg" ? "jpg" : "png";
  const title = (docTitleInput.value || "Snapmark_Capture").replace(/[\\/:*?"<>|]+/g, "_");

  canvas.toBlob(
    async (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({
        url,
        filename: `${title}.${ext}`,
        saveAs: true,
      });
      showToast(`Saved as ${ext.toUpperCase()} (100% Quality)!`);
    },
    mime,
    1.0
  );
});

/**
 * Export: Save to PDF
 */
btnSavePdf.addEventListener("click", async () => {
  const canvas = getCompositeCanvas();
  canvas.toBlob(
    async (jpegBlob) => {
      if (!jpegBlob) return;
      const buffer = await jpegBlob.arrayBuffer();
      const jpegBytes = new Uint8Array(buffer);
      const pdfBytes = buildPdf(jpegBytes, canvas.width, canvas.height);
      const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(pdfBlob);
      const title = (docTitleInput.value || "Snapmark_Capture").replace(/[\\/:*?"<>|]+/g, "_");

      await chrome.downloads.download({
        url,
        filename: `${title}.pdf`,
        saveAs: true,
      });
      showToast("Vector PDF exported successfully!");
    },
    "image/jpeg",
    1.0
  );
});

/**
 * Export: Print Screenshot
 */
btnPrint.addEventListener("click", () => {
  const canvas = getCompositeCanvas();
  const printWin = window.open("", "_blank");
  if (!printWin) {
    showToast("Popup blocked by browser.");
    return;
  }
  printWin.document.write(`
    <html>
      <head><title>${docTitleInput.value || "Print Screenshot"}</title></head>
      <body style="margin:0; padding:0; display:flex; justify-content:center; align-items:center; background:#1e1e1e;">
        <img src="${canvas.toDataURL("image/png")}" style="max-width:100%; height:auto;" onload="window.print(); window.close();" />
      </body>
    </html>
  `);
  printWin.document.close();
});



/**
 * Zoom Controls
 */
btnZoomIn.addEventListener("click", () => {
  zoom = Math.min(3, zoom + 0.15);
  applyZoom();
});

btnZoomOut.addEventListener("click", () => {
  zoom = Math.max(0.15, zoom - 0.15);
  applyZoom();
});

btnZoomFit.addEventListener("click", fitToWidth);

zoomLabel.addEventListener("click", () => {
  if (Math.abs(zoom - 1) < 0.02) {
    fitToWidth();
  } else {
    zoom = 1;
    applyZoom();
  }
});

// Auto-adjust fit on window resize
window.addEventListener("resize", () => {
  const availableWidth = Math.max(300, canvasScroll.clientWidth - 110);
  if (zoom < 1 || rawWidth > availableWidth) {
    fitToWidth();
  }
});


btnUndo.addEventListener("click", undo);
btnRedo.addEventListener("click", redo);

if (btnExtractTextEditor) {
  btnExtractTextEditor.addEventListener("click", () => {
    if (!captureImg || !captureImg.src) {
      showToast("No image available to extract text from.");
      return;
    }
    showToast("Extracting text from image...");
    if (!document.getElementById("snapmark-ocr-host")) {
      const script = document.createElement("script");
      script.src = "ocr-modal.js";
      document.body.appendChild(script);
    }
    chrome.runtime.sendMessage({
      action: "ocr-process-custom-image",
      dataUrl: captureImg.src,
      lang: "detect",
    });
  });
}

/**
 * Global Keyboard Shortcuts
 * ESC: Clears all drawings/annotations immediately
 */
document.addEventListener("keydown", (e) => {
  // ESC Key: Clear all annotations or close active inline text input box
  if (e.key === "Escape") {
    const openBox = document.querySelector(".inline-text-box");
    if (openBox) {
      openBox.remove();
      return;
    }
    if (annotations.length > 0) {
      pushHistory();
      annotations.length = 0;
      selectedItem = null;
      renderCanvas();
      showToast("All annotations cleared! (Ctrl+Z to Undo)");
    }
    return;
  }

  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
    return;
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedItem) {
      e.preventDefault();
      const idx = annotations.indexOf(selectedItem);
      if (idx !== -1) {
        pushHistory();
        annotations.splice(idx, 1);
        selectedItem = null;
        renderCanvas();
      }
    }
    return;
  }

  const k = e.key.toLowerCase();
  if (k === "v") selectTool("select");
  else if (k === "t") selectTool("add-text");
  else if (k === "p") selectTool("pen");
  else if (k === "h") selectTool("highlighter");
  else if (k === "r") selectTool("rect-stroke");
  else if (k === "o") selectTool("ellipse-stroke");
  else if (k === "l") selectTool("line-solid");
  else if (k === "a") selectTool("arrow-single");
  else if (k === "n") selectTool("number-badge");
  else if (k === "b") selectTool("blur-redact");
  else if (k === "s") selectTool("spotlight");
  else if (k === "e") selectTool("eraser");
});

// Run Initialization
initAdobeTooltips();
initEditor();
