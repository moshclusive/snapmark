/**
 * Snapmark - Interactive Area Selection Script (FireShot Inspired)
 * Features:
 * - Hold CTRL to snap to & capture any specific HTML element or section (cards, scrollable divs, semantic blocks)
 * - Compact, sleek top hint banner
 * - Immediate full-screen dimming overlay on activation
 * - Full-screen crosshair guidelines (horizontal & vertical) following mouse
 * - Auto-scroll when dragging near viewport edges
 * - Multi-viewport selection tracking in document coordinates
 * - Crisp dashed outline with dimension badge
 * - Zero border/stroke artifacts on captured image (clean unmount & frame settle)
 */
(() => {
  if (window.__snapmarkCleanup) {
    try { window.__snapmarkCleanup(); } catch {}
  }
  const oldContainer = document.getElementById("snapmark-selection-container");
  if (oldContainer) oldContainer.remove();
  window.__snapmarkSelectionActive = true;

  let isSelecting = false;
  let isCtrlActive = false;
  let hoveredElement = null;

  let startDocX = 0;
  let startDocY = 0;
  let currentDocX = 0;
  let currentDocY = 0;
  let startClientX = 0;
  let startClientY = 0;
  let currentClientX = 0;
  let currentClientY = 0;
  let lastClientX = Math.round(window.innerWidth / 2);
  let lastClientY = Math.round(window.innerHeight / 2);
  let isCtrlLocked = false;
  let hasAutoScrolled = false;
  let autoScrollTimer = null;
  let scrollSpeedX = 0;
  let scrollSpeedY = 0;
  let detectedBlocks = [];

  // Create UI Container
  const container = document.createElement("div");
  container.id = "snapmark-selection-container";

  // Create 4 dimming masks
  const maskTop = document.createElement("div");
  const maskBottom = document.createElement("div");
  const maskLeft = document.createElement("div");
  const maskRight = document.createElement("div");
  [maskTop, maskBottom, maskLeft, maskRight].forEach((m) => {
    m.className = "snapmark-dim-mask";
    container.appendChild(m);
  });

  // Crosshair Hairline Guidelines across whole screen
  const guideH = document.createElement("div");
  guideH.className = "snapmark-crosshair-h";
  container.appendChild(guideH);

  const guideV = document.createElement("div");
  guideV.className = "snapmark-crosshair-v";
  container.appendChild(guideV);

  // Selection outline box
  const box = document.createElement("div");
  box.id = "snapmark-selection-box";
  box.style.display = "none";
  container.appendChild(box);

  // Dimension Badge
  const badge = document.createElement("div");
  badge.id = "snapmark-selection-badge";
  badge.style.display = "none";
  container.appendChild(badge);

  // Top Hint Banner (FireShot Style - Compact & Small as requested)
  const isOcr = !!window.__snapmarkOcrMode;
  const hint = document.createElement("div");
  hint.id = "snapmark-selection-hint";
  if (isOcr) {
    hint.innerHTML = `<span style="color:#f97316; font-weight:700;">EXTRACT TEXT:</span> Drag to select text/image area • Hold <kbd>CTRL</kbd> to snap element • <kbd>ESC</kbd> to exit`;
  } else {
    hint.innerHTML = `<span style="color:#38bdf8; font-weight:700;">HINT:</span> Hold <kbd>CTRL</kbd> to inspect & click HTML element • Drag to select area • <kbd>ESC</kbd> to exit`;
  }
  container.appendChild(hint);

  document.documentElement.appendChild(container);

  // Initially dim the entire viewport before user clicks
  function initDim() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    maskTop.style.cssText = `top:0; left:0; width:${vw}px; height:${vh}px;`;
    maskBottom.style.cssText = `top:0; left:0; width:0px; height:0px;`;
    maskLeft.style.cssText = `top:0; left:0; width:0px; height:0px;`;
    maskRight.style.cssText = `top:0; left:0; width:0px; height:0px;`;
  }
  initDim();

  function updateMasks(vx, vy, vw, vh) {
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    const clampedX = Math.max(0, Math.min(winW, vx));
    const clampedY = Math.max(0, Math.min(winH, vy));
    const clampedW = Math.max(0, Math.min(winW - clampedX, vw));
    const clampedH = Math.max(0, Math.min(winH - clampedY, vh));

    maskTop.style.cssText = `top:0; left:0; width:${winW}px; height:${clampedY}px;`;
    maskBottom.style.cssText = `top:${clampedY + clampedH}px; left:0; width:${winW}px; height:${Math.max(0, winH - clampedY - clampedH)}px;`;
    maskLeft.style.cssText = `top:${clampedY}px; left:0; width:${clampedX}px; height:${clampedH}px;`;
    maskRight.style.cssText = `top:${clampedY}px; left:${clampedX + clampedW}px; width:${Math.max(0, winW - clampedX - clampedW)}px; height:${clampedH}px;`;
  }

  /**
   * Pre-scans the DOM to identify major blocks, scrollable sections, and pin/card containers
   * (Inspired by FireShot's Qe pre-scan method)
   */
  function scanPageBlocks() {
    detectedBlocks = [];
    if (!document.body) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    while ((node = walker.nextNode())) {
      if (node.id === "snapmark-selection-container" || node.closest("#snapmark-selection-container")) continue;

      const rect = node.getBoundingClientRect();
      if (rect.width < 35 || rect.height < 35) continue;
      if (rect.bottom < 0 || rect.top > winH || rect.right < 0 || rect.left > winW) continue;

      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) continue;

      const isScrollable = (
        (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflowX === "auto" || style.overflowX === "scroll") &&
        (node.scrollHeight > node.clientHeight + 10 || node.scrollWidth > node.clientWidth + 10)
      );

      const tag = node.tagName.toLowerCase();
      const isSemanticBlock = (
        tag === "article" ||
        tag === "section" ||
        tag === "aside" ||
        tag === "nav" ||
        tag === "header" ||
        tag === "footer" ||
        tag === "main" ||
        tag === "figure" ||
        node.getAttribute("role") === "article" ||
        node.getAttribute("role") === "listitem" ||
        node.getAttribute("role") === "region" ||
        node.hasAttribute("data-test-id") ||
        node.hasAttribute("data-grid-item") ||
        node.classList.contains("card") ||
        node.classList.contains("pin")
      );

      if (isScrollable || isSemanticBlock) {
        detectedBlocks.push({
          el: node,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            area: rect.width * rect.height,
          },
        });
      }
    }

    // Sort by area ascending so smaller inner blocks match before outer wrappers
    detectedBlocks.sort((a, b) => a.rect.area - b.rect.area);
  }

  scanPageBlocks();

  /**
   * Resolves raw element into a meaningful block / section
   */
  function resolveBlockElement(rawEl) {
    if (!rawEl || rawEl === document.documentElement || rawEl === document.body) return null;

    // SVG internals
    if (rawEl instanceof SVGElement && rawEl.tagName.toLowerCase() !== "svg") {
      rawEl = rawEl.closest("svg") || rawEl;
    }

    // If it's an image, video, or picture with solid size
    if (rawEl.tagName === "IMG" || rawEl.tagName === "VIDEO" || rawEl.tagName === "PICTURE") {
      const r = rawEl.getBoundingClientRect();
      if (r.width > 30 && r.height > 30) return rawEl;
    }

    // If it's a button or interactive control
    const btn = rawEl.closest("button, [role='button'], a.btn, .btn");
    if (btn) {
      const br = btn.getBoundingClientRect();
      if (br.width > 20 && br.height > 15) return btn;
    }

    // Check for nearest card, pin, article, or section
    const card = rawEl.closest("[data-test-id], [role='article'], [role='listitem'], article, section, figure, aside, header, nav, .card, .pin, .post, .item, .feed-item");
    if (card && card !== document.body && card !== document.documentElement) {
      const cr = card.getBoundingClientRect();
      if (cr.width > 30 && cr.height > 30) return card;
    }

    // Check if element is inside any of pre-scanned blocks
    for (let i = 0; i < detectedBlocks.length; i++) {
      if (detectedBlocks[i].el.contains(rawEl)) {
        return detectedBlocks[i].el;
      }
    }

    // If it's a text/inline leaf, walk up to enclosing block container
    let cur = rawEl;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const s = window.getComputedStyle(cur);
      const r = cur.getBoundingClientRect();
      const isBlock = s.display === "block" || s.display === "flex" || s.display === "grid" || s.display === "inline-block";
      if (isBlock && r.width > 40 && r.height > 20) {
        return cur;
      }
      cur = cur.parentElement;
    }

    return rawEl;
  }

  /**
   * Identifies element under cursor for CTRL inspection
   * Hides the overlay synchronously to guarantee zero hit-test interception
   */
  function getElementUnderPoint(clientX, clientY) {
    // 1. Check pre-scanned blocks & sections (FireShot method)
    for (let i = 0; i < detectedBlocks.length; i++) {
      const b = detectedBlocks[i];
      const r = b.el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.left + r.width && clientY >= r.top && clientY <= r.top + r.height) {
        if (r.width > 30 && r.height > 30 && r.width <= window.innerWidth * 0.98) {
          return b.el;
        }
      }
    }

    // 2. Query document.elementFromPoint with container completely hidden
    container.style.setProperty("display", "none", "important");
    let rawEl = document.elementFromPoint(clientX, clientY);
    container.style.removeProperty("display");

    if (!rawEl || rawEl === document.documentElement || rawEl === document.body) return null;
    if (rawEl.id === "snapmark-selection-container" || rawEl.closest("#snapmark-selection-container")) return null;

    // 3. Resolve to best block/section
    return resolveBlockElement(rawEl);
  }

  function updateElementHover(clientX, clientY) {
    if (isSelecting) return;
    const el = getElementUnderPoint(clientX, clientY);
    if (!el) {
      clearElementHover();
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      clearElementHover();
      return;
    }

    hoveredElement = el;

    const clampedX = Math.max(0, rect.left);
    const clampedY = Math.max(0, rect.top);
    const clampedW = Math.min(rect.width, window.innerWidth - clampedX);
    const clampedH = Math.min(rect.height, window.innerHeight - clampedY);

    box.style.display = "block";
    box.style.left = `${clampedX}px`;
    box.style.top = `${clampedY}px`;
    box.style.width = `${clampedW}px`;
    box.style.height = `${clampedH}px`;
    box.classList.add("snap-element-mode");

    updateMasks(clampedX, clampedY, clampedW, clampedH);

    guideH.style.display = "none";
    guideV.style.display = "none";

    badge.style.display = "flex";
    const badgeY = clampedY - 32 >= 8 ? clampedY - 32 : clampedY + clampedH + 8;
    const badgeX = Math.max(8, Math.min(clampedX, window.innerWidth - 260));
    badge.style.left = `${badgeX}px`;
    badge.style.top = `${badgeY}px`;

    let tagDesc = el.tagName.toLowerCase();
    if (el.getAttribute("data-test-id")) {
      tagDesc += `[${el.getAttribute("data-test-id")}]`;
    } else if (el.id) {
      tagDesc += `#${el.id.slice(0, 14)}`;
    } else if (el.className && typeof el.className === "string") {
      const firstClass = el.className.trim().split(/\s+/)[0];
      if (firstClass && !firstClass.includes("snapmark")) {
        tagDesc += `.${firstClass.slice(0, 14)}`;
      }
    }

    badge.innerHTML = `
      <span class="element-tag">&lt;${tagDesc}&gt;</span>
      <span>${Math.round(rect.width)} × ${Math.round(rect.height)} px</span>
      <span class="click-tag">Click to Capture</span>
    `;
  }

  function clearElementHover() {
    hoveredElement = null;
    if (!isSelecting) {
      box.style.display = "none";
      box.classList.remove("snap-element-mode");
      badge.style.display = "none";
      guideH.style.display = "block";
      guideV.style.display = "block";
      initDim();
    }
  }

  function getCalculatedBounds(e) {
    isCtrlLocked = e ? !!e.ctrlKey : false;

    // Viewport-based bounds
    let rawClientW = Math.abs(currentClientX - startClientX);
    let rawClientH = Math.abs(currentClientY - startClientY);
    if (isCtrlLocked) {
      const side = Math.max(rawClientW, rawClientH);
      rawClientW = side;
      rawClientH = side;
    }
    const viewX = currentClientX >= startClientX ? startClientX : Math.max(0, startClientX - rawClientW);
    const viewY = currentClientY >= startClientY ? startClientY : Math.max(0, startClientY - rawClientH);
    const viewW = Math.min(rawClientW, window.innerWidth - viewX);
    const viewH = Math.min(rawClientH, window.innerHeight - viewY);

    // Document-based bounds
    let rawDocW = Math.abs(currentDocX - startDocX);
    let rawDocH = Math.abs(currentDocY - startDocY);
    if (isCtrlLocked) {
      const side = Math.max(rawDocW, rawDocH);
      rawDocW = side;
      rawDocH = side;
    }
    const docX = currentDocX >= startDocX ? startDocX : Math.max(0, startDocX - rawDocW);
    const docY = currentDocY >= startDocY ? startDocY : Math.max(0, startDocY - rawDocH);
    const docW = rawDocW;
    const docH = rawDocH;

    return { viewX, viewY, viewW, viewH, docX, docY, docW, docH, isCtrlLocked };
  }

  function onMouseDown(e) {
    if (e.button !== 0) return; // Left click only

    // 1. If holding CTRL and an HTML element/block is hovered (or clicked): 1-click capture!
    if (isCtrlActive || e.ctrlKey) {
      if (!hoveredElement) {
        hoveredElement = getElementUnderPoint(e.clientX, e.clientY);
      }

      if (hoveredElement) {
        e.preventDefault();
        e.stopPropagation();
        const rect = hoveredElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        container.style.display = "none";
        cleanup();

        const finalViewX = Math.round(Math.max(0, rect.left));
        const finalViewY = Math.round(Math.max(0, rect.top));
        const finalW = Math.round(Math.min(rect.width, window.innerWidth - finalViewX));
        const finalH = Math.round(Math.min(rect.height, window.innerHeight - finalViewY));

        // Check if element is a very long section taller than viewport
        const needsMultiScroll = rect.height > window.innerHeight * 0.95 && hoveredElement.scrollHeight > rect.height + 40;

        if (finalW > 4 && finalH > 4) {
          requestAnimationFrame(() => {
            setTimeout(() => {
              chrome.runtime.sendMessage({
                action: "selection-completed",
                rect: {
                  viewX: finalViewX,
                  viewY: finalViewY,
                  width: finalW,
                  height: finalH,
                  needsMultiScroll,
                  docX: Math.round(rect.left + window.scrollX),
                  docY: Math.round(rect.top + window.scrollY),
                  docW: Math.round(rect.width),
                  docH: Math.round(rect.height),
                  windowWidth: window.innerWidth,
                  windowHeight: window.innerHeight,
                  scrollX: window.scrollX,
                  scrollY: window.scrollY,
                  dpr,
                },
              });
            }, 50);
          });
        } else {
          chrome.runtime.sendMessage({ action: "selection-cancelled" });
        }
        return;
      }
    }

    // 2. Otherwise start standard rectangular drag selection
    isSelecting = true;
    hasAutoScrolled = false;
    box.classList.remove("snap-element-mode");

    startClientX = e.clientX;
    startClientY = e.clientY;
    currentClientX = e.clientX;
    currentClientY = e.clientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;

    startDocX = e.clientX + window.scrollX;
    startDocY = e.clientY + window.scrollY;
    currentDocX = startDocX;
    currentDocY = startDocY;

    box.style.display = "block";
    badge.style.display = "flex";
    hint.style.display = "none";

    startAutoScrollLoop();
    render(e);
  }

  function onMouseMove(e) {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    isCtrlActive = !!e.ctrlKey;

    if (!isSelecting) {
      if (isCtrlActive) {
        updateElementHover(e.clientX, e.clientY);
      } else {
        clearElementHover();
      }
      guideH.style.top = `${e.clientY}px`;
      guideV.style.left = `${e.clientX}px`;
      return;
    }

    currentClientX = e.clientX;
    currentClientY = e.clientY;
    currentDocX = e.clientX + window.scrollX;
    currentDocY = e.clientY + window.scrollY;

    // Calculate auto-scroll speed when dragging near edges
    computeAutoScrollSpeed(e.clientX, e.clientY);
    render(e);
  }

  function onScroll() {
    scanPageBlocks();
    if (isCtrlActive && !isSelecting) {
      updateElementHover(lastClientX, lastClientY);
    }
  }

  function computeAutoScrollSpeed(clientX, clientY) {
    const threshold = 70;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    scrollSpeedX = 0;
    scrollSpeedY = 0;

    if (clientY > winH - threshold) {
      scrollSpeedY = Math.min(28, Math.max(4, (clientY - (winH - threshold)) * 0.45));
    } else if (clientY < threshold) {
      scrollSpeedY = -Math.min(28, Math.max(4, (threshold - clientY) * 0.45));
    }

    if (clientX > winW - threshold) {
      scrollSpeedX = Math.min(28, Math.max(4, (clientX - (winW - threshold)) * 0.45));
    } else if (clientX < threshold) {
      scrollSpeedX = -Math.min(28, Math.max(4, (threshold - clientX) * 0.45));
    }
  }

  function startAutoScrollLoop() {
    if (autoScrollTimer) return;
    autoScrollTimer = setInterval(() => {
      if (!isSelecting) {
        clearInterval(autoScrollTimer);
        autoScrollTimer = null;
        return;
      }

      if (scrollSpeedX !== 0 || scrollSpeedY !== 0) {
        hasAutoScrolled = true;
        window.scrollBy({ left: scrollSpeedX, top: scrollSpeedY, behavior: "instant" });
        currentDocX = lastClientX + window.scrollX;
        currentDocY = lastClientY + window.scrollY;
        render(null);
      }
    }, 25);
  }

  function stopAutoScrollLoop() {
    if (autoScrollTimer) {
      clearInterval(autoScrollTimer);
      autoScrollTimer = null;
    }
    scrollSpeedX = 0;
    scrollSpeedY = 0;
  }

  function render(e) {
    const b = getCalculatedBounds(e);

    let dispX = b.viewX;
    let dispY = b.viewY;
    let dispW = b.viewW;
    let dispH = b.viewH;

    if (hasAutoScrolled) {
      dispX = b.docX - window.scrollX;
      dispY = b.docY - window.scrollY;
      dispW = b.docW;
      dispH = b.docH;
    }

    box.style.left = `${dispX}px`;
    box.style.top = `${dispY}px`;
    box.style.width = `${dispW}px`;
    box.style.height = `${dispH}px`;

    updateMasks(dispX, dispY, dispW, dispH);

    // Position badge neatly near active corner
    const badgeY = dispY + dispH + 8 < window.innerHeight - 32 ? dispY + dispH + 8 : Math.max(8, dispY - 32);
    const badgeX = Math.min(Math.max(8, dispX), window.innerWidth - 180);
    badge.style.left = `${badgeX}px`;
    badge.style.top = `${badgeY}px`;

    const dpr = window.devicePixelRatio || 1;
    const finalBoxW = Math.round(hasAutoScrolled ? b.docW : b.viewW);
    const finalBoxH = Math.round(hasAutoScrolled ? b.docH : b.viewH);
    const realW = Math.round(finalBoxW * dpr);
    const realH = Math.round(finalBoxH * dpr);

    badge.innerHTML = `
      <span>${finalBoxW} × ${finalBoxH} px</span>
      <span style="opacity: 0.6; font-size: 11px;">(${realW} × ${realH} native)</span>
      ${b.isCtrlLocked ? '<span class="square-tag">1:1 Square</span>' : ""}
    `;
  }

  function cleanup() {
    stopAutoScrollLoop();
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("scroll", onScroll);
    container.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    container.style.display = "none";
    container.remove();
    window.__snapmarkSelectionActive = false;
    window.__snapmarkCleanup = null;
  }
  window.__snapmarkCleanup = cleanup;

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      window.__snapmarkOcrMode = false;
      chrome.runtime.sendMessage({ action: "selection-cancelled" });
      return;
    }
    if (e.key === "Control") {
      isCtrlActive = true;
      if (!isSelecting) {
        updateElementHover(lastClientX, lastClientY);
      } else {
        render(e);
      }
    }
  }

  function onKeyUp(e) {
    if (e.key === "Control") {
      isCtrlActive = false;
      if (!isSelecting) {
        clearElementHover();
      } else {
        render(e);
      }
    }
  }

  function onMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;
    stopAutoScrollLoop();

    if (e) {
      currentClientX = e.clientX;
      currentClientY = e.clientY;
      currentDocX = e.clientX + window.scrollX;
      currentDocY = e.clientY + window.scrollY;
    }

    const b = getCalculatedBounds(e);
    const isCurrentOcr = isOcr;

    // Completely remove overlay DOM and wait 50ms for browser compositor paint
    // to guarantee ZERO blue border/stroke or selection artifacts in screenshot!
    container.style.display = "none";
    cleanup();
    window.__snapmarkOcrMode = false;

    // Check whether the selected box is currently visible in the active viewport
    const curTop = window.scrollY;
    const curBottom = window.scrollY + window.innerHeight;
    const isBoxInsideCurrentViewport = b.docY >= curTop - 5 && b.docY + b.docH <= curBottom + 10;
    const needsMultiScroll = hasAutoScrolled && !isBoxInsideCurrentViewport && b.docH > window.innerHeight * 0.9;

    const finalW = needsMultiScroll ? b.docW : isBoxInsideCurrentViewport ? b.docW : b.viewW;
    const finalH = needsMultiScroll ? b.docH : isBoxInsideCurrentViewport ? b.docH : b.viewH;

    const activeViewX = isBoxInsideCurrentViewport ? b.docX - window.scrollX : b.viewX;
    const activeViewY = isBoxInsideCurrentViewport ? b.docY - window.scrollY : b.viewY;

    if (finalW > 8 && finalH > 8) {
      const dpr = window.devicePixelRatio || 1;
      // Wait for clean compositor frame
      requestAnimationFrame(() => {
        setTimeout(() => {
          chrome.runtime.sendMessage({
            action: "selection-completed",
            isOcr: isCurrentOcr,
            rect: {
              viewX: Math.round(activeViewX),
              viewY: Math.round(activeViewY),
              width: Math.round(finalW),
              height: Math.round(finalH),
              needsMultiScroll,
              docX: Math.round(b.docX),
              docY: Math.round(b.docY),
              docW: Math.round(b.docW),
              docH: Math.round(b.docH),
              windowWidth: window.innerWidth,
              windowHeight: window.innerHeight,
              scrollX: window.scrollX,
              scrollY: window.scrollY,
              dpr,
            },
          });
        }, 50);
      });
    } else {
      chrome.runtime.sendMessage({ action: "selection-cancelled" });
    }
  }

  container.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
})();
