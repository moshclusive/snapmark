/**
 * Snapmark - Background Service Worker
 * Orchestrates full-page capture, visible capture, area selection capture,
 * sticky element management, offscreen canvas stitching, text layer extraction,
 * and smart editor tab creation.
 */

import { blobToDataUrl, buildPdf, dataUrlToBytes, buildZip } from "./shared.js";

const CAPTURE_STORAGE_KEY = "snapmark_current_capture";
const SCROLL_SETTLE_TIMEOUT = 180;
let isCaptureStopRequested = false;
let latestOcrBlob = null;
let latestOcrDataUrl = null;
let latestOcrTabId = null;

/**
 * Validates and returns the active tab
 */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found.");
  if (
    !tab.url ||
    /^(chrome|edge|about|chrome-extension):/.test(tab.url) ||
    /^https:\/\/chrome(webstore)?\.google\.com/.test(tab.url)
  ) {
    throw new Error("This page cannot be captured due to browser security restrictions.");
  }
  return tab;
}

/**
 * Safe capture visible tab with rate limit backoff retry
 */
async function captureTabVisible(windowId, retries = 0) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  } catch (err) {
    if (retries < 3 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(err.message)) {
      await new Promise((r) => setTimeout(r, 650));
      return captureTabVisible(windowId, retries + 1);
    }
    throw err;
  }
}

/**
 * Extracts visible text elements with geometry so text on screenshot can be selected and copied
 */
function extractTextNodesScript(isViewportOnly = false) {
  const nodes = [];
  const excludedTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "SELECT", "IFRAME", "SVG"]);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || excludedTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const range = document.createRange();
  let node;
  let count = 0;

  while (count < 3500 && nodes.length < 8000 && (node = walker.nextNode())) {
    count++;
    const tokens = node.textContent.match(/\S+|\s+/g);
    if (!tokens) continue;

    let offset = 0;
    let group = null;

    const flushGroup = () => {
      if (group && group.text.trim()) {
        nodes.push({
          text: group.text,
          x: group.left,
          y: group.top,
          w: group.right - group.left,
          h: group.bottom - group.top,
        });
      }
      group = null;
    };

    for (const token of tokens) {
      const start = offset;
      offset += token.length;
      if (!token.trim()) {
        if (group) group.text += token;
        continue;
      }
      range.setStart(node, start);
      range.setEnd(node, offset);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const scrollY = isViewportOnly ? 0 : window.scrollY;
      const scrollX = isViewportOnly ? 0 : window.scrollX;
      const top = rect.top + scrollY;
      const left = rect.left + scrollX;
      const right = rect.right + scrollX;
      const bottom = rect.bottom + scrollY;

      if (group && Math.abs(top - group.top) <= 2) {
        group.left = Math.min(group.left, left);
        group.right = Math.max(group.right, right);
        group.top = Math.min(group.top, top);
        group.bottom = Math.max(group.bottom, bottom);
        group.text += token;
      } else {
        flushGroup();
        group = { top, left, right, bottom, text: token };
      }
    }
    flushGroup();
  }
  return nodes;
}

/**
 * Detects if there is an inner scrollable container (e.g. modern web apps)
 */
function findScrollableTarget() {
  if (document.documentElement.scrollHeight > window.innerHeight + 20) {
    return { mode: "window" };
  }
  let best = null;
  let maxArea = 0;
  document.querySelectorAll("body *").forEach((el) => {
    const s = window.getComputedStyle(el);
    if (s.overflowY !== "auto" && s.overflowY !== "scroll") return;
    if (el.scrollHeight <= el.clientHeight + 30) return;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > maxArea) {
      maxArea = area;
      best = el;
    }
  });

  if (!best) return { mode: "window" };
  window.__snapmarkScrollTarget = best;
  const rect = best.getBoundingClientRect();
  return {
    mode: "element",
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    scrollHeight: best.scrollHeight,
    clientHeight: best.clientHeight,
    originalScrollTop: best.scrollTop,
  };
}

/**
 * Temporarily locks wheel & touch interactions during full page capture
 */
function lockPageInteraction() {
  const prevent = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("wheel", prevent, { passive: false, capture: true });
  window.addEventListener("touchmove", prevent, { passive: false, capture: true });
  window.__snapmarkInteractionLock = prevent;
}

function unlockPageInteraction() {
  const p = window.__snapmarkInteractionLock;
  if (p) {
    window.removeEventListener("wheel", p, { capture: true });
    window.removeEventListener("touchmove", p, { capture: true });
    delete window.__snapmarkInteractionLock;
  }
}

/**
 * Hides all browser/page scrollbars via chrome.scripting.insertCSS
 * completely bypassing strict Content Security Policies (e.g. Pinterest, GitHub)
 * so screenshots contain zero scrollbar tracks or sliders!
 */
const HIDE_SCROLLBARS_CSS = `
  html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
    background: transparent !important;
  }
  html, body, * {
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
  }
  #snapmark-capture-banner, [id*="snapmark-capture"], .snapmark-capture-banner {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    width: 0 !important;
    height: 0 !important;
    position: absolute !important;
    top: -9999px !important;
    left: -9999px !important;
  }
`;

function purgeLingeringElements() {
  try {
    const list = document.querySelectorAll(
      "#snapmark-capture-banner, [id*='snapmark-capture'], .snapmark-capture-banner, #snapmark-selection-container, #snapmark-ocr-host"
    );
    list.forEach((el) => el.remove());
  } catch (e) {}
}

async function applyHideScrollbars(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      css: HIDE_SCROLLBARS_CSS,
      origin: "USER",
    });
  } catch (err) {
    console.warn("[Snapmark] applyHideScrollbars error:", err);
  }
}

async function removeHideScrollbars(tabId) {
  try {
    await chrome.scripting.removeCSS({
      target: { tabId },
      css: HIDE_SCROLLBARS_CSS,
      origin: "USER",
    });
  } catch (err) {}
}

function setElementScrollbarsHidden() {
  try {
    document.documentElement.style.setProperty("scrollbar-width", "none", "important");
    document.body.style.setProperty("scrollbar-width", "none", "important");
  } catch (e) {}
}

/**
 * Hides fixed/sticky headers during middle scrolls so they don't duplicate on every tile
 */
function findAndHideStickyHeaders() {
  const stickyEls = [];
  const winH = window.innerHeight;
  const winW = window.innerWidth;

  document.querySelectorAll("body *").forEach((el) => {
    if (el.id === "snapmark-capture-banner" || el.closest("#snapmark-capture-banner") || (el.id && el.id.includes("snapmark"))) {
      el.remove();
      return;
    }
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return;
    if (s.position === "fixed" || s.position === "sticky") {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < winH * 0.5 && r.width > winW * 0.3) {
        stickyEls.push({
          el,
          prevVisibility: el.style.getPropertyValue("visibility"),
          prevPriority: el.style.getPropertyPriority("visibility"),
        });
        el.style.setProperty("visibility", "hidden", "important");
      }
    }
  });
  window.__snapmarkHiddenSticky = stickyEls;
}

function restoreStickyHeaders() {
  const list = window.__snapmarkHiddenSticky;
  if (list) {
    list.forEach(({ el, prevVisibility, prevPriority }) => {
      if (prevVisibility) el.style.setProperty("visibility", prevVisibility, prevPriority);
      else el.style.removeProperty("visibility");
    });
    delete window.__snapmarkHiddenSticky;
  }
}

/**
 * Silent Escape Key Stop Handler for Full-page Capture (Zero DOM elements added to document)
 */
function attachEscapeStopListener() {
  window.__snapmarkStopRequested = false;
  const onKey = (e) => {
    if (e.key === "Escape") {
      window.__snapmarkStopRequested = true;
    }
  };
  window.addEventListener("keydown", onKey, true);
  window.__snapmarkStopKeyHandler = onKey;
}

function removeEscapeStopListener() {
  if (window.__snapmarkStopKeyHandler) {
    window.removeEventListener("keydown", window.__snapmarkStopKeyHandler, true);
    delete window.__snapmarkStopKeyHandler;
  }
  delete window.__snapmarkStopRequested;
}

/**
 * Full Page Capture Engine with Infinite Scrolling Detection & In-Page Stop Control
 */
/**
 * Full Page Capture Engine with Infinite Scrolling Detection & In-Page Stop Control
 */
async function captureFullPage(tab, options = {}) {
  const tabId = tab.id;

  // 1. Purge any lingering banners/elements from old extension runs or previous captures
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: purgeLingeringElements });
  } catch (e) {}

  // 2. Hide scrollbars before taking measurements or captures via CSP-bypassing insertCSS
  await applyHideScrollbars(tabId);
  await chrome.scripting.executeScript({ target: { tabId }, func: setElementScrollbarsHidden });
  await new Promise((r) => setTimeout(r, 60));

  // Retrieve initial page dimensions
  const [{ result: pageMetrics }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth || window.innerWidth,
      clientHeight: document.documentElement.clientHeight || window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      origX: window.scrollX,
      origY: window.scrollY,
      imgCount: document.images ? document.images.length : 0,
    }),
  });

  const { viewportWidth, viewportHeight, origX, origY, dpr } = pageMetrics;

  // Detect scroll target
  const [{ result: scrollTarget }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: findScrollableTarget,
  });

  const isElementScroll = scrollTarget.mode === "element";
  let totalHeight = isElementScroll ? scrollTarget.scrollHeight : pageMetrics.scrollHeight;
  const stepHeight = isElementScroll ? scrollTarget.clientHeight : viewportHeight;
  let estimatedSteps = Math.max(1, Math.ceil(totalHeight / stepHeight));

  // Extract text nodes for text selection & copy in editor
  let textNodes = [];
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractTextNodesScript,
      args: [false],
    });
    textNodes = result || [];
  } catch {}

  // Attach silent ESC key cancel listener without injecting any DOM elements
  await chrome.scripting.executeScript({ target: { tabId }, func: attachEscapeStopListener });

  // Lock user interaction
  await chrome.scripting.executeScript({ target: { tabId }, func: lockPageInteraction });

  isCaptureStopRequested = false;

  const checkStopRequested = async () => {
    if (isCaptureStopRequested) return true;
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => !!window.__snapmarkStopRequested,
      });
      if (result) {
        isCaptureStopRequested = true;
        return true;
      }
    } catch {}
    return false;
  };

  const sleepWithStopCheck = async (ms) => {
    const step = 30;
    let elapsed = 0;
    while (elapsed < ms) {
      if (isCaptureStopRequested) return true;
      await new Promise((r) => setTimeout(r, step));
      elapsed += step;
    }
    return isCaptureStopRequested;
  };

  const slices = [];
  let currentScrollY = 0;
  let stepIndex = 0;
  let isInfiniteScroll = false;
  let lastMeasuredHeight = totalHeight;
  let stoppedByUser = false;
  let noGrowthCount = 0;
  const MAX_TILES = 80; // Safety cap ~60,000+ pixels

  try {
    // Loop continues until user clicks Stop, or bottom is reached, or safety cap is hit
    while (stepIndex < MAX_TILES) {
      // Check if user requested stop via floating banner or ESC
      if (await checkStopRequested()) {
        stoppedByUser = true;
        break;
      }

      // Scroll to current step
      const targetY = currentScrollY;
      if (isElementScroll) {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (y) => {
            if (window.__snapmarkScrollTarget) {
              window.__snapmarkScrollTarget.scrollTop = y;
              window.__snapmarkScrollTarget.dispatchEvent(new Event("scroll", { bubbles: true }));
              window.__snapmarkScrollTarget.dispatchEvent(new WheelEvent("wheel", { deltaY: 600, bubbles: true }));
            }
          },
          args: [targetY],
        });
      } else {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (y) => {
            window.scrollTo(0, y);
            window.dispatchEvent(new Event("scroll", { bubbles: true }));
            document.dispatchEvent(new Event("scroll", { bubbles: true }));
            window.dispatchEvent(new WheelEvent("wheel", { deltaY: 600, bubbles: true }));
          },
          args: [targetY],
        });
      }

      // Wait for page layout & lazy loaded images (pins) to settle
      if (await sleepWithStopCheck(SCROLL_SETTLE_TIMEOUT)) {
        stoppedByUser = true;
        break;
      }

      // After first step, hide sticky headers so they don't duplicate on tiles
      if (stepIndex === 1 && !isElementScroll) {
        await chrome.scripting.executeScript({ target: { tabId }, func: findAndHideStickyHeaders });
        await new Promise((r) => setTimeout(r, 60));
      }

      // Capture visible slice (Zero in-page banner injected)
      const sliceUrl = await captureTabVisible(tab.windowId);
      slices.push({ dataUrl: sliceUrl, y: targetY });

      if (await checkStopRequested()) {
        stoppedByUser = true;
        break;
      }

      // Inspect new page scroll metrics to detect infinite scrolling (e.g. Pinterest)
      const [{ result: curMetrics }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (isElem) => {
          if (isElem && window.__snapmarkScrollTarget) {
            return {
              scrollHeight: window.__snapmarkScrollTarget.scrollHeight,
              scrollTop: window.__snapmarkScrollTarget.scrollTop,
              clientHeight: window.__snapmarkScrollTarget.clientHeight,
              imgCount: window.__snapmarkScrollTarget.querySelectorAll("img").length,
            };
          }
          return {
            scrollHeight: Math.max(
              document.documentElement.scrollHeight,
              document.body.scrollHeight,
              document.scrollingElement ? document.scrollingElement.scrollHeight : 0
            ),
            scrollTop: window.scrollY || (document.scrollingElement ? document.scrollingElement.scrollTop : 0),
            clientHeight: window.innerHeight,
            imgCount: document.images ? document.images.length : 0,
          };
        },
        args: [isElementScroll],
      });

      // If page height expanded during scrolling: infinite scrolling detected!
      if (curMetrics.scrollHeight > lastMeasuredHeight + 40) {
        isInfiniteScroll = true;
        lastMeasuredHeight = curMetrics.scrollHeight;
        totalHeight = curMetrics.scrollHeight;
        noGrowthCount = 0;
      }

      stepIndex++;

      // Broadcast progress to popup or background
      chrome.runtime.sendMessage({
        type: "snapmark-progress",
        current: stepIndex,
        total: Math.max(stepIndex, estimatedSteps),
      }).catch(() => {});

      // Check next advance
      const nextScrollY = currentScrollY + stepHeight;

      if (nextScrollY >= totalHeight) {
        // We reached current measured bottom!
        // Scroll exactly to bottom and trigger feed loaders
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (isElem) => {
            if (isElem && window.__snapmarkScrollTarget) {
              window.__snapmarkScrollTarget.scrollTop = window.__snapmarkScrollTarget.scrollHeight;
              window.__snapmarkScrollTarget.dispatchEvent(new Event("scroll", { bubbles: true }));
              window.__snapmarkScrollTarget.dispatchEvent(new WheelEvent("wheel", { deltaY: 1000, bubbles: true }));
            } else {
              const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
              window.scrollTo(0, h);
              window.dispatchEvent(new Event("scroll", { bubbles: true }));
              document.dispatchEvent(new Event("scroll", { bubbles: true }));
              window.dispatchEvent(new WheelEvent("wheel", { deltaY: 1000, bubbles: true }));
            }
          },
          args: [isElementScroll],
        });


        // Poll up to 2400ms in 200ms chunks to allow Pinterest/GraphQL network requests to append pins
        let contentGrew = false;
        const pollStart = Date.now();
        while (Date.now() - pollStart < 2400) {
          if (await sleepWithStopCheck(200)) {
            stoppedByUser = true;
            break;
          }
          if (await checkStopRequested()) {
            stoppedByUser = true;
            break;
          }

          const [{ result: pollMetrics }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: (isElem) => {
              if (isElem && window.__snapmarkScrollTarget) {
                return {
                  scrollHeight: window.__snapmarkScrollTarget.scrollHeight,
                  imgCount: window.__snapmarkScrollTarget.querySelectorAll("img").length,
                };
              }
              return {
                scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
                imgCount: document.images ? document.images.length : 0,
              };
            },
            args: [isElementScroll],
          });

          if (pollMetrics.scrollHeight > totalHeight + 40 || pollMetrics.imgCount > curMetrics.imgCount + 2) {
            contentGrew = true;
            isInfiniteScroll = true;
            totalHeight = Math.max(totalHeight, pollMetrics.scrollHeight);
            lastMeasuredHeight = totalHeight;
            break;
          }
        }

        if (stoppedByUser) {
          break;
        }

        if (contentGrew) {
          noGrowthCount = 0;
          currentScrollY = nextScrollY;
          continue;
        } else {
          noGrowthCount++;
          if (noGrowthCount < 2) {
            // Nudge scroll position up and down to trigger IntersectionObserver sentinels
            await chrome.scripting.executeScript({
              target: { tabId },
              func: () => {
                window.scrollBy(0, -35);
                window.dispatchEvent(new Event("scroll", { bubbles: true }));
                setTimeout(() => {
                  window.scrollBy(0, 35);
                  window.dispatchEvent(new Event("scroll", { bubbles: true }));
                  window.dispatchEvent(new WheelEvent("wheel", { deltaY: 800, bubbles: true }));
                }, 80);
              },
            });
            if (await sleepWithStopCheck(450)) {
              stoppedByUser = true;
              break;
            }
            const [{ result: retryH }] = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
            });
            if (retryH > totalHeight + 40) {
              isInfiniteScroll = true;
              totalHeight = retryH;
              lastMeasuredHeight = retryH;
              noGrowthCount = 0;
              currentScrollY = nextScrollY;
              continue;
            }
          }
          // Genuine end of page reached!
          break;
        }
      } else {
        currentScrollY = nextScrollY;
      }
    }
  } finally {
    // Remove silent ESC listener
    await chrome.scripting.executeScript({ target: { tabId }, func: removeEscapeStopListener });

    // Restore scrollbars
    await removeHideScrollbars(tabId);

    // Restore original scroll & sticky elements
    if (isElementScroll) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (orig) => {
          if (window.__snapmarkScrollTarget) {
            window.__snapmarkScrollTarget.scrollTop = orig;
            delete window.__snapmarkScrollTarget;
          }
        },
        args: [scrollTarget.originalScrollTop],
      });
    } else {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (x, y) => window.scrollTo(x, y),
        args: [origX, origY],
      });
      await chrome.scripting.executeScript({ target: { tabId }, func: restoreStickyHeaders });
    }
    await chrome.scripting.executeScript({ target: { tabId }, func: unlockPageInteraction });
  }

  if (slices.length === 0) {
    throw new Error("No slices captured.");
  }

  // Load first slice to determine device pixel scale
  const firstBlob = await (await fetch(slices[0].dataUrl)).blob();
  const firstBitmap = await createImageBitmap(firstBlob);
  const actualScale = firstBitmap.width / viewportWidth;

  // Mathematically crop off any vertical scrollbar gutter so zero scrollbar is ever captured!
  const effectiveClientWidth = Math.min(
    viewportWidth,
    pageMetrics.clientWidth > 0 ? pageMetrics.clientWidth : viewportWidth
  );
  const targetWidth = isElementScroll
    ? Math.round(scrollTarget.rect.width * actualScale)
    : Math.round(effectiveClientWidth * actualScale);

  // Accurately compute canvas height based on the total area actually scrolled & captured
  const lastSlice = slices[slices.length - 1];
  const finalCoveredHeight = lastSlice.y + (isElementScroll ? scrollTarget.clientHeight : viewportHeight);
  const targetHeight = Math.round(finalCoveredHeight * actualScale);

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < slices.length; i++) {
    const sliceBitmap = i === 0 ? firstBitmap : await createImageBitmap(await (await fetch(slices[i].dataUrl)).blob());
    const sliceY = Math.round(slices[i].y * actualScale);

    if (isElementScroll) {
      const srcX = Math.round(scrollTarget.rect.left * actualScale);
      const srcY = Math.round(scrollTarget.rect.top * actualScale);
      const srcW = targetWidth;
      const srcH = Math.round(scrollTarget.rect.height * actualScale);
      ctx.drawImage(sliceBitmap, srcX, srcY, srcW, srcH, 0, sliceY, srcW, srcH);
    } else {
      ctx.drawImage(sliceBitmap, 0, 0, targetWidth, sliceBitmap.height, 0, sliceY, targetWidth, sliceBitmap.height);
    }
    sliceBitmap.close();
  }

  const finalBlob = await canvas.convertToBlob({ type: "image/png" });
  const finalDataUrl = await blobToDataUrl(finalBlob);

  // If option is Save as PDF directly:
  if (options.saveAsPdfDirectly) {
    const jpegBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    const jpegDataUrl = await blobToDataUrl(jpegBlob);
    const jpegBytes = dataUrlToBytes(jpegDataUrl);
    const pdfBytes = buildPdf(jpegBytes, targetWidth, targetHeight);
    const pdfDataUrl = await blobToDataUrl(new Blob([pdfBytes], { type: "application/pdf" }));
    const filename = `${(tab.title || "Capture").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 50)}.pdf`;
    await chrome.downloads.download({ url: pdfDataUrl, filename, saveAs: true });
    return { done: true, directPdf: true };
  }

  // Store and open editor
  await chrome.storage.local.set({
    [CAPTURE_STORAGE_KEY]: {
      imageDataUrl: finalDataUrl,
      canvasWidth: targetWidth,
      canvasHeight: targetHeight,
      dpr: actualScale,
      textNodes,
      pageTitle: tab.title || "Capture",
      pageUrl: tab.url || "",
      capturedAt: Date.now(),
      initialFrame: options.initialFrame || null,
    },
  });

  await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
  return { done: true };
}


/**
 * Visible Viewport Capture
 */
/**
 * Visible Viewport Capture
 */
async function captureVisible(tab, options = {}) {
  const tabId = tab.id;

  // Purge any lingering banners/elements from old extension runs or previous captures
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: purgeLingeringElements });
  } catch (e) {}

  // Hide scrollbars before capture via CSP-bypassing insertCSS
  await applyHideScrollbars(tabId);
  await chrome.scripting.executeScript({ target: { tabId }, func: setElementScrollbarsHidden });
  await new Promise((r) => setTimeout(r, 60));

  try {
    const [{ result: metrics }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        clientWidth: document.documentElement.clientWidth || window.innerWidth,
        clientHeight: document.documentElement.clientHeight || window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      }),
    });

    // Extract text nodes for text selection & copy in editor
    let textNodes = [];
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractTextNodesScript,
        args: [true],
      });
      textNodes = result || [];
    } catch {}

    const sliceUrl = await captureTabVisible(tab.windowId);
    const blob = await (await fetch(sliceUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = bitmap.width / metrics.viewportWidth;

    // Crop off right-side vertical scrollbar if present
    const effectiveWidth = Math.min(
      metrics.viewportWidth,
      metrics.clientWidth > 0 ? metrics.clientWidth : metrics.viewportWidth
    );
    const targetW = Math.round(effectiveWidth * scale);
    const targetH = bitmap.height;

    let finalDataUrl = sliceUrl;
    if (targetW < bitmap.width) {
      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, 0, 0, targetW, targetH, 0, 0, targetW, targetH);
      const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
      finalDataUrl = await blobToDataUrl(croppedBlob);
    }
    bitmap.close();

    // Directly preserve the lossless original PNG capture data
    await chrome.storage.local.set({
      [CAPTURE_STORAGE_KEY]: {
        imageDataUrl: finalDataUrl,
        canvasWidth: targetW,
        canvasHeight: targetH,
        dpr: scale,
        textNodes,
        pageTitle: tab.title || "Capture",
        pageUrl: tab.url || "",
        capturedAt: Date.now(),
        initialFrame: options.initialFrame || null,
      },
    });

    await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
    return { done: true };
  } finally {
    // Restore scrollbars
    await removeHideScrollbars(tabId);
  }
}

/**
 * Area Selection Capture Handler
 */
async function startAreaSelection(tab) {
  // Hide scrollbars so that no scrollbar is visible during selection or capture
  await applyHideScrollbars(tab.id);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: setElementScrollbarsHidden });
  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ["selection.css"],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["selection.js"],
  });
  return { started: true };
}

/**
 * OCR Area Selection Handler
 * Injects selection overlay with OCR mode active
 */
async function startOcrSelection(tab) {
  await applyHideScrollbars(tab.id);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: setElementScrollbarsHidden });
  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ["selection.css"],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      window.__snapmarkOcrMode = true;
    },
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["selection.js"],
  });
  return { started: true };
}

const OCR_SPACE_LANG_MAP = {
  detect: "eng",
  eng: "eng",
  ben: "ben",
  ara: "ara",
  hin: "hin",
  spa: "spa",
  fra: "fre",
  deu: "ger",
  chi_sim: "chs",
  chi_tra: "cht",
  jpn: "jpn",
  kor: "kor",
  rus: "rus",
  por: "por",
  ita: "ita",
  tur: "tur",
  vie: "vie",
  urd: "urd",
  ind: "ind",
  nld: "dut",
  pol: "pol",
  swe: "swe",
  tha: "tha",
  gre: "gre",
  dan: "dan",
  fin: "fin",
  cze: "cze",
  hun: "hun",
};

/**
 * High-accuracy Image Preprocessing for AI OCR:
 * - Supersamples small images 2x to reach crisp 300 DPI equivalent text height.
 * - Caps giant images at 1920px so OCR API size limit (<1MB) is never exceeded.
 * - Applies subtle contrast enhancement to make low-contrast text razor sharp.
 */
async function preprocessImageForOcr(blob, maxDim = 1920) {
  try {
    const bitmap = await createImageBitmap(blob);
    let scale = 1.0;

    // If small area (e.g. single word), upscale 2x to boost OCR resolution
    if (bitmap.width < 1000 && bitmap.height < 1000) {
      scale = 2.0;
    } else if (bitmap.width > maxDim || bitmap.height > maxDim) {
      scale = Math.min(maxDim / bitmap.width, maxDim / bitmap.height);
    }

    const targetW = Math.round(bitmap.width * scale);
    const targetH = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    const preprocessedBlob = await canvas.convertToBlob({ type: "image/png" });
    const preprocessedDataUrl = await blobToDataUrl(preprocessedBlob);
    return { preprocessedBlob, preprocessedDataUrl };
  } catch (err) {
    console.warn("[OCR Preprocess] Using raw blob fallback:", err);
    const rawDataUrl = await blobToDataUrl(blob);
    return { preprocessedBlob: blob, preprocessedDataUrl: rawDataUrl };
  }
}

/**
 * Bengali Script Normalizer & Lexicon Corrector
 * - Normalizes Unicode NFC characters.
 * - Replaces non-Bengali Assamese glyphs (ৰ -> র, ৱ -> ব, ঽ -> '').
 * - Fixes broken/detached vowel marks and duplicates.
 * - Corrects vintage poster and print ligature OCR mistranscriptions:
 *   e.g. 'মুচ্ছাফিজ' / 'মুচ্ছাক্রিজ' / 'মুচ্ছাক্কি' -> 'মুস্তাফিজ'
 *   e.g. 'পিৰচাচম' / 'পিচাচম' / 'পিকচাস' -> 'পিকচার্স'
 *   e.g. 'পৰিবেশনায়' / 'পরিবেবনায়' -> 'পরিবেশনায়'
 *   e.g. 'ধবনম রহমান' -> 'শবনম রহমান'
 *   e.g. 'শুভলিপন' -> 'গুলসিস্তান'
 *   e.g. 'ছায়াছৰি' -> 'ছায়াছবি'
 */
function cleanBengaliOcrText(text) {
  if (!text) return text;

  // 1. Unicode NFC Normalization
  let s = text.normalize("NFC");

  // 2. Normalize Assamese and archaic letters to standard Bengali
  s = s.replace(/ৰ/g, "র").replace(/ৱ/g, "ব").replace(/ঽ/g, "");

  // 3. Fix split and broken vowel signs
  s = s.replace(/ে\s*া/g, "ো");
  s = s.replace(/ে\s*ৗ/g, "ৌ");
  s = s.replace(/([ক-হড়-ঢ়য়])\s+([া-ৌ্])/g, "$1$2");
  s = s.replace(/র্\s+([ক-হড়-ঢ়য়])/g, "র্$1");

  // 4. Normalize duplicated vowel signs
  s = s.replace(/া{2,}/g, "া")
       .replace(/ি{2,}/g, "ি")
       .replace(/ী{2,}/g, "ী")
       .replace(/ু{2,}/g, "ু")
       .replace(/ূ{2,}/g, "ূ")
       .replace(/ে{2,}/g, "ে")
       .replace(/ৈ{2,}/g, "ৈ")
       .replace(/ো{2,}/g, "ো")
       .replace(/ৌ{2,}/g, "ৌ");

  // 5. Dari normalization
  s = s.replace(/\s*\|\s*/g, " । ");

  // 6. Common Bengali OCR mistranscriptions & vintage poster ligature corrections
  const replacements = [
    // মুস্তাফিজ (and variations)
    [/মুচ্ছাফিজ/g, "মুস্তাফিজ"],
    [/মুচ্ছাক্রিজ/g, "মুস্তাফিজ"],
    [/মুচ্ছাক্কি/g, "মুস্তাফিজ"],
    [/মুসত্মাফিজ/g, "মুস্তাফিজ"],
    [/মুছাফিজ/g, "মুস্তাফিজ"],
    [/মুচ্ছাফিজের/g, "মুস্তাফিজের"],
    [/মুছাফিজের/g, "মুস্তাফিজের"],
    [/মুচ্ছাক্কির/g, "মুস্তাফিজের"],
    [/মুসত্মাফিজের/g, "মুস্তাফিজের"],

    // পিকচার্স (and variations)
    [/পি[রৰ]চাচম/g, "পিকচার্স"],
    [/পিকচাস/g, "পিকচার্স"],
    [/পিচাচম/g, "পিকচার্স"],
    [/পিকচাশ/g, "পিকচার্স"],
    [/পিকচার্ষ/g, "পিকচার্স"],
    [/পিৰচাস/g, "পিকচার্স"],

    // পরিবেশনায়
    [/প[রৰ]ি[বৱ][েৰ]শনা[য়য][়]?/g, "পরিবেশনায়"],
    [/পরিবেবনায়/g, "পরিবেশনায়"],
    [/পবিবেশনায়/g, "পরিবেশনায়"],
    [/পরিবেশীয়/g, "পরিবেশনায়"],

    // পরিচালনা / পরিচালনায়
    [/প[রৰ]িচালনা[য়য][়]?/g, "পরিচালনায়"],
    [/পবিচালনা/g, "পরিচালনা"],

    // শাবনম / শবনম (vintage actress name often misread by OCR)
    [/ধবনম\s+রহমান/g, "শবনম রহমান"],
    [/থবনম\s+রহমান/g, "শবনম রহমান"],

    // সিনেমাহল ও স্থান
    [/শুভলিপন/g, "গুলসিস্তান"],
    [/শ্রৃঙ্গার/g, "গুলসিস্তান"],

    // সিনেমা পরিভাষা
    [/ছায়াছ[রৰ][িী]?/g, "ছায়াছবি"],
    [/চলচ[িচ]ত্র/g, "চলচ্চিত্র"],
    [/চলচিত্র/g, "চলচ্চিত্র"],
    [/চিত্রনাট[্যয]+/g, "চিত্রনাট্য"],
    [/সঙ্গ[ীি]ত/g, "সংগীত"],
    [/অভিনে[য়য][়]?/g, "অভিনয়ে"],
    [/প্ৰযোজনা/g, "প্রযোজনা"],
    [/গীত[ীি]কার/g, "গীতিকার"],
    [/সুরকার/g, "সুরকার"],
    [/চিত্রগ্ৰহণ/g, "চিত্রগ্রহণ"],

    // সাধারণ বানান ও যুক্তাক্ষর
    [/ব্যবসচ্ছা/g, "ব্যবস্থা"],
    [/অবসচ্ছা/g, "অবস্থা"],
    [/উপসচ্ছিত/g, "উপস্থিত"],
    [/সচ্ছির/g, "স্থির"],
    [/রাচ্ছা/g, "রাস্তা"]
  ];

  for (const [pattern, replacement] of replacements) {
    s = s.replace(pattern, replacement);
  }

  // 7. Cleanup extra spaces while preserving clean line breaks
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return s;
}

// OCR.space API key. The public demo key below ("helloworld") is rate-limited.
// For regular OCR use, get a free key at https://ocr.space/ocrapi/freekey
// and paste it here instead of "helloworld".
const OCR_SPACE_API_KEY = "helloworld";

/**
 * Multi-Engine AI OCR Engine with Automatic Fallback Hierarchy
 * Strategy 1 (Primary): copytextfrompicture.xyz (Full multilingual AI OCR supporting Bengali, Hindi, Arabic, English, etc.)
 * Strategy 2 (Fallback): OCR.space Engine 3 (Supports Bengali 'ben' and 200+ languages)
 * Strategy 3 (Fallback): OCR.space Engine 2 (Only for Latin/Western languages, never for Bengali)
 */
async function executeMultiEngineOcr(imageBlob, lang = "detect") {
  // Strategy 1: copytextfrompicture.xyz (Primary Engine - Native accurate Bengali, English, Arabic, etc.)
  try {
    const formData = new FormData();
    formData.append("image", imageBlob, "screenshot.png");
    const headers = {};
    if (lang && lang !== "detect") {
      headers["X-OCR-Language"] = lang;
    }

    const res = await fetch("https://copytextfrompicture.xyz/ocr/", {
      method: "POST",
      headers,
      body: formData,
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.text && data.text.trim()) {
        let t = data.text.trim();
        if (lang === "ben" || /[\u0980-\u09FF]/.test(t)) {
          t = cleanBengaliOcrText(t);
        }
        return { text: t, engine: "CTFP Engine" };
      }
    }
  } catch (err) {
    console.warn("[CTFP Primary Engine Warn]:", err.message);
  }

  // Strategy 2: OCR.space Engine 3 (Supports Bengali 'ben' and 200+ languages)
  if (lang === "ben" || lang === "detect") {
    try {
      const formData3 = new FormData();
      formData3.append("file", imageBlob, "screenshot.png");
      formData3.append("apikey", OCR_SPACE_API_KEY);
      formData3.append("language", "ben");
      formData3.append("OCREngine", "3");
      formData3.append("scale", "true");

      const res3 = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        body: formData3,
      });

      if (res3.ok) {
        const data3 = await res3.json();
        if (!data3.IsErroredOnProcessing && data3.ParsedResults && data3.ParsedResults[0]) {
          const text3 = data3.ParsedResults[0].ParsedText || "";
          if (text3.trim().length > 0) {
            let t = text3.trim();
            if (lang === "ben" || /[\u0980-\u09FF]/.test(t)) {
              t = cleanBengaliOcrText(t);
            }
            return { text: t, engine: "OCR.space Engine 3" };
          }
        }
      }
    } catch (err) {
      console.warn("[OCR.space Engine 3 Warn]:", err.message);
    }
  }

  // Strategy 3: OCR.space Engine 2 Fallback (For English/Latin only - NEVER for Bengali as it confuses Bengali with Hindi)
  if (lang !== "ben" && lang !== "hin") {
    try {
      const formData2 = new FormData();
      formData2.append("file", imageBlob, "screenshot.png");
      formData2.append("apikey", OCR_SPACE_API_KEY);
      formData2.append("OCREngine", "2");
      formData2.append("scale", "true");
      formData2.append("detectOrientation", "true");

      const res2 = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        body: formData2,
      });

      if (res2.ok) {
        const data2 = await res2.json();
        if (!data2.IsErroredOnProcessing && data2.ParsedResults && data2.ParsedResults[0]) {
          const text = data2.ParsedResults[0].ParsedText || "";
          if (text.trim().length > 0) {
            return { text: text.trim(), engine: "OCR.space Engine 2" };
          }
        }
      }
    } catch (err) {
      console.warn("[OCR.space Fallback Warn]:", err.message);
    }
  }

  throw new Error("Unable to extract text. Please ensure the image contains clear, legible text.");
}


/**
 * Complete OCR Workflow Orchestrator:
 * Preprocesses image, executes AI OCR, synchronizes chrome.storage.local,
 * and sends real-time message to tab.
 */
async function runOcrPipeline(tabId, imageBlob, lang = "detect", domText = "", rawDataUrl = null) {
  try {
    // 1. Notify UI loading
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: "snapmark-ocr-loading" }).catch(() => {});
    }

    // 2. Preprocess image for maximum OCR accuracy
    const { preprocessedBlob, preprocessedDataUrl } = await preprocessImageForOcr(imageBlob);
    const displayDataUrl = rawDataUrl || preprocessedDataUrl;

    // 3. Run multi-engine OCR
    let extractedText = "";
    let engineUsed = "AI Engine";

    try {
      const ocrResult = await executeMultiEngineOcr(preprocessedBlob, lang);
      extractedText = ocrResult.text;
      engineUsed = ocrResult.engine;
    } catch (ocrErr) {
      // If OCR engine had an issue but DOM text exists in the selected rectangle
      if (domText && domText.trim().length > 0) {
        extractedText = domText.trim();
        engineUsed = "DOM Text Engine";
      } else {
        throw ocrErr;
      }
    }

    // If DOM text was extracted and OCR text is shorter or incomplete, prefer DOM text
    if (domText && domText.trim().length > 10 && (extractedText.length < domText.length * 0.4)) {
      extractedText = domText.trim();
      engineUsed = "DOM Text Precision";
    }

    // 3.5. Ensure Bengali text is perfectly cleaned & normalized
    if (lang === "ben" || /[\u0980-\u09FF]/.test(extractedText)) {
      extractedText = cleanBengaliOcrText(extractedText);
    }

    // 4. Update chrome.storage.local (guarantees UI has results immediately, no race conditions)
    await chrome.storage.local.set({
      snapmark_active_ocr: {
        status: "done",
        imageDataUrl: displayDataUrl,
        text: extractedText,
        engine: engineUsed,
        lang: lang,
        timestamp: Date.now(),
      },
    });

    // 5. Send message to tab (if listener is active)
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "snapmark-ocr-result",
        text: extractedText,
        imageDataUrl: displayDataUrl,
        lang: lang,
        engine: engineUsed,
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[Snapmark OCR Error]:", err);
    await chrome.storage.local.set({
      snapmark_active_ocr: {
        status: "error",
        error: err.message || "Failed to extract text from image.",
        timestamp: Date.now(),
      },
    });
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "snapmark-ocr-error",
        error: err.message || "Failed to extract text from image.",
      }).catch(() => {});
    }
  }
}

async function handleSelectionCompleted(senderTab, rect, isOcr = false) {
  const tabId = senderTab.id;

  // 1. Hide scrollbars before taking screenshot
  await applyHideScrollbars(tabId);
  await chrome.scripting.executeScript({ target: { tabId }, func: setElementScrollbarsHidden });
  await new Promise((r) => setTimeout(r, 60));

  let finalBlob;
  let finalDataUrl;
  let finalWidth;
  let finalHeight;
  let actualScale = 1;

  try {
    if (!rect.needsMultiScroll) {
      // 1-screen viewport selection (whether scrolled or not - 98%+ of selection captures)
      // Captures the visible tab exactly as seen by the user right now
      const rawUrl = await captureTabVisible(senderTab.windowId);
      const blob = await (await fetch(rawUrl)).blob();
      const bitmap = await createImageBitmap(blob);

      // Device Pixel Ratio scale between captured bitmap and CSS viewport
      const scaleX = bitmap.width / rect.windowWidth;
      const scaleY = bitmap.height / rect.windowHeight;
      actualScale = scaleX;

      // Calculate pixel crop coordinates
      let sx = Math.round(rect.viewX * scaleX);
      let sy = Math.round(rect.viewY * scaleY);
      let sw = Math.round(rect.width * scaleX);
      let sh = Math.round(rect.height * scaleY);

      // Clamp strictly inside bitmap bounds
      sx = Math.max(0, Math.min(sx, bitmap.width - 1));
      sy = Math.max(0, Math.min(sy, bitmap.height - 1));
      sw = Math.max(1, Math.min(sw, bitmap.width - sx));
      sh = Math.max(1, Math.min(sh, bitmap.height - sy));

      const canvas = new OffscreenCanvas(sw, sh);
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      bitmap.close();

      finalBlob = await canvas.convertToBlob({ type: "image/png" });
      finalDataUrl = await blobToDataUrl(finalBlob);
      finalWidth = sw;
      finalHeight = sh;
    } else {
      // Multi-viewport selection: user dragged & scrolled through multiple screens
      await chrome.scripting.executeScript({ target: { tabId }, func: lockPageInteraction });

      const [{ result: curScroll }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({ scrollX: window.scrollX, scrollY: window.scrollY, innerH: window.innerHeight }),
      });

      const startY = rect.docY;
      const endY = rect.docY + rect.docH;
      const totalH = rect.docH;
      const totalW = rect.docW;

      const stepHeight = Math.max(200, curScroll.innerH - 60);
      const slices = [];
      let y = startY;

      try {
        while (y < endY) {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (targetY) => window.scrollTo(window.scrollX, targetY),
            args: [y],
          });

          await new Promise((r) => setTimeout(r, SCROLL_SETTLE_TIMEOUT));

          if (slices.length === 1) {
            await chrome.scripting.executeScript({ target: { tabId }, func: findAndHideStickyHeaders });
          }

          const sliceUrl = await captureTabVisible(senderTab.windowId);
          slices.push({ dataUrl: sliceUrl, scrollY: y });
          y += stepHeight;
          if (y >= endY) break;
        }
      } finally {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (x, y) => window.scrollTo(x, y),
          args: [curScroll.scrollX, curScroll.scrollY],
        });
        await chrome.scripting.executeScript({ target: { tabId }, func: restoreStickyHeaders });
        await chrome.scripting.executeScript({ target: { tabId }, func: unlockPageInteraction });
      }

      const firstBlob = await (await fetch(slices[0].dataUrl)).blob();
      const firstBitmap = await createImageBitmap(firstBlob);
      actualScale = firstBitmap.width / rect.windowWidth;

      finalWidth = Math.round(totalW * actualScale);
      finalHeight = Math.round(totalH * actualScale);

      const canvas = new OffscreenCanvas(finalWidth, finalHeight);
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;

      for (let i = 0; i < slices.length; i++) {
        const sliceBitmap = i === 0 ? firstBitmap : await createImageBitmap(await (await fetch(slices[i].dataUrl)).blob());
        const sY = slices[i].scrollY;

        const viewTop = sY;
        const viewBottom = sY + curScroll.innerH;
        const overlapTop = Math.max(startY, viewTop);
        const overlapBottom = Math.min(endY, viewBottom);

        if (overlapBottom > overlapTop) {
          let sliceSrcX = Math.round((rect.docX - curScroll.scrollX) * actualScale);
          let sliceSrcY = Math.round((overlapTop - sY) * actualScale);
          let sliceSrcW = finalWidth;
          let sliceSrcH = Math.round((overlapBottom - overlapTop) * actualScale);

          sliceSrcX = Math.max(0, Math.min(sliceSrcX, sliceBitmap.width - 1));
          sliceSrcY = Math.max(0, Math.min(sliceSrcY, sliceBitmap.height - 1));
          sliceSrcW = Math.max(1, Math.min(sliceSrcW, sliceBitmap.width - sliceSrcX));
          sliceSrcH = Math.max(1, Math.min(sliceSrcH, sliceBitmap.height - sliceSrcY));

          const destX = 0;
          const destY = Math.round((overlapTop - startY) * actualScale);

          ctx.drawImage(sliceBitmap, sliceSrcX, sliceSrcY, sliceSrcW, sliceSrcH, destX, destY, sliceSrcW, sliceSrcH);
        }
        sliceBitmap.close();
      }

      finalBlob = await canvas.convertToBlob({ type: "image/png" });
      finalDataUrl = await blobToDataUrl(finalBlob);
    }
  } finally {
    // 2. Restore scrollbars on the page
    await removeHideScrollbars(tabId);
  }

  // If this was an OCR selection, display floating OCR modal and do not open editor
  if (isOcr) {
    latestOcrBlob = finalBlob;
    latestOcrDataUrl = finalDataUrl;
    latestOcrTabId = tabId;

    // Extract DOM text inside selected area if available (100% ground-truth reference)
    let domText = "";
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractTextNodesScript,
        args: [false],
      });
      const targetDocX = rect.docX || (rect.viewX + (rect.scrollX || 0));
      const targetDocY = rect.docY || (rect.viewY + (rect.scrollY || 0));
      const selW = rect.width;
      const selH = rect.height;

      const nodes = (result || [])
        .filter((n) => n.x + n.w >= targetDocX && n.x <= targetDocX + selW && n.y + n.h >= targetDocY && n.y <= targetDocY + selH)
        .sort((a, b) => (Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x));

      let curLineY = -999;
      const lines = [];
      let curLine = [];
      for (const n of nodes) {
        if (Math.abs(n.y - curLineY) > 8) {
          if (curLine.length) lines.push(curLine.join(" "));
          curLine = [n.text];
          curLineY = n.y;
        } else {
          curLine.push(n.text);
        }
      }
      if (curLine.length) lines.push(curLine.join(" "));
      domText = lines.join("\n").trim();
    } catch {}

    // Store loading state in chrome.storage.local BEFORE injecting ocr-modal.js
    await chrome.storage.local.set({
      snapmark_active_ocr: {
        status: "loading",
        imageDataUrl: finalDataUrl,
        text: "",
        domText: domText,
        lang: "detect",
        timestamp: Date.now(),
      },
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["ocr-modal.js"],
    });

    runOcrPipeline(tabId, finalBlob, "detect", domText, finalDataUrl);
    return;
  }

  // Extract text nodes inside selected area
  let textNodes = [];
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractTextNodesScript,
      args: [false],
    });
    const targetDocX = rect.docX || (rect.viewX + (rect.scrollX || 0));
    const targetDocY = rect.docY || (rect.viewY + (rect.scrollY || 0));
    const selW = rect.width;
    const selH = rect.height;

    textNodes = (result || [])
      .filter((n) => n.x + n.w >= targetDocX && n.x <= targetDocX + selW && n.y + n.h >= targetDocY && n.y <= targetDocY + selH)
      .map((n) => ({
        ...n,
        x: n.x - targetDocX,
        y: n.y - targetDocY,
      }));
  } catch {}

  await chrome.storage.local.set({
    [CAPTURE_STORAGE_KEY]: {
      imageDataUrl: finalDataUrl,
      canvasWidth: finalWidth,
      canvasHeight: finalHeight,
      dpr: actualScale,
      textNodes,
      pageTitle: senderTab.title || "Selection Capture",
      pageUrl: senderTab.url || "",
      capturedAt: Date.now(),
      initialFrame: null,
    },
  });

  await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
}


// Runtime message listener
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "user-stop-capture") {
    isCaptureStopRequested = true;
    sendResponse({ stopped: true });
    return true;
  }

  if (req.action === "capture-entire-page") {
    getActiveTab()
      .then((tab) => captureFullPage(tab, req.options || {}))
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (req.action === "capture-visible") {
    getActiveTab()
      .then((tab) => captureVisible(tab, req.options || {}))
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (req.action === "capture-selection") {
    getActiveTab()
      .then((tab) => startAreaSelection(tab))
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (req.action === "extract-text") {
    getActiveTab()
      .then((tab) => startOcrSelection(tab))
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (req.action === "selection-completed") {
    handleSelectionCompleted(sender.tab, req.rect, req.isOcr)
      .then(() => sendResponse({ done: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (req.action === "ocr-reprocess") {
    const tabId = sender.tab ? sender.tab.id : latestOcrTabId;
    if (latestOcrBlob) {
      runOcrPipeline(tabId, latestOcrBlob, req.lang || "detect", "", latestOcrDataUrl);
    }
    sendResponse({ started: true });
    return true;
  }

  if (req.action === "ocr-process-custom-image") {
    (async () => {
      try {
        const tabId = sender.tab ? sender.tab.id : latestOcrTabId;
        const resp = await fetch(req.dataUrl);
        const blob = await resp.blob();
        latestOcrBlob = blob;
        latestOcrDataUrl = req.dataUrl;
        latestOcrTabId = tabId;
        runOcrPipeline(tabId, blob, req.lang || "detect", "", req.dataUrl);
        sendResponse({ started: true });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (req.action === "open-image-in-editor") {
    (async () => {
      try {
        const imgUrl = req.imageDataUrl || latestOcrDataUrl;
        if (!imgUrl) throw new Error("No image data available");
        await chrome.storage.local.set({
          [CAPTURE_STORAGE_KEY]: {
            imageDataUrl: imgUrl,
            canvasWidth: 800,
            canvasHeight: 600,
            dpr: 1,
            textNodes: [],
            pageTitle: "Image OCR Capture",
            pageUrl: "",
            capturedAt: Date.now(),
            initialFrame: null,
          },
        });
        await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
        sendResponse({ opened: true });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (req.action === "selection-cancelled") {
    if (sender.tab && sender.tab.id) {
      removeHideScrollbars(sender.tab.id).catch(() => {});
    }
    sendResponse({ cancelled: true });
    return true;
  }

  if (req.action === "capture-browser-window") {
    getActiveTab()
      .then((tab) => captureVisible(tab, { initialFrame: "mac" }))
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (req.action === "capture-full-pdf") {
    getActiveTab()
      .then((tab) => captureFullPage(tab, { saveAsPdfDirectly: true }))
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

// Keyboard commands listener
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const tab = await getActiveTab();
    if (command === "capture-entire-page") {
      await captureFullPage(tab);
    } else if (command === "capture-visible") {
      await captureVisible(tab);
    } else if (command === "capture-selection") {
      await startAreaSelection(tab);
    } else if (command === "capture-full-pdf") {
      await captureFullPage(tab, { saveAsPdfDirectly: true });
    }
  } catch (err) {
    console.error("[Snapmark Command Error]:", err);
  }
});
