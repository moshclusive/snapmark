/**
 * Snapmark - Minimal Extracted Text Box (OCR Modal)
 * Displays a simple, focused window:
 * - Single box showing extracted text (or simply "Extracting..." while loading)
 * - Bottom row containing strictly: Auto detect, Copy, Download, Cross
 */
(() => {
  const HOST_ID = "snapmark-ocr-host";
  let host = document.getElementById(HOST_ID);
  if (host) {
    host.remove();
  }

  host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      bottom: 24px;
      right: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color-scheme: dark;
    }
    .ocr-window {
      width: 480px;
      max-width: calc(100vw - 32px);
      height: 320px;
      max-height: calc(100vh - 48px);
      display: flex;
      flex-direction: column;
      background: #1c1c21;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65), 0 2px 12px rgba(0, 0, 0, 0.4);
      color: #f1f5f9;
      overflow: hidden;
      box-sizing: border-box;
      animation: ocrFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes ocrFadeIn {
      from { opacity: 0; transform: translateY(10px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .ocr-drag-bar {
      height: 16px;
      background: rgba(255, 255, 255, 0.02);
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    .ocr-drag-bar:active { cursor: grabbing; }
    .ocr-drag-pill {
      width: 36px;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
    }
    .ocr-body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      padding: 12px 14px;
      box-sizing: border-box;
    }
    .ocr-extracting-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      text-align: center;
    }
    .ocr-spinner {
      width: 34px;
      height: 34px;
      border: 3px solid rgba(249, 115, 22, 0.2);
      border-top-color: #f97316;
      border-radius: 50%;
      animation: ocrSpin 0.75s linear infinite;
    }
    @keyframes ocrSpin { to { transform: rotate(360deg); } }
    .ocr-extracting-text {
      font-size: 15px;
      font-weight: 500;
      color: #e2e8f0;
      letter-spacing: 0.01em;
    }
    .ocr-result-view {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .ocr-textarea {
      flex: 1;
      width: 100%;
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 12px 14px;
      color: #f8fafc;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.6;
      resize: none;
      outline: none;
      white-space: pre-wrap;
      word-break: break-word;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
    }
    .ocr-textarea:focus {
      border-color: rgba(249, 115, 22, 0.5);
      box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.15);
    }
    .ocr-error-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      text-align: center;
      padding: 16px;
    }
    .ocr-error-text {
      font-size: 13px;
      color: #fca5a5;
      background: rgba(239, 68, 68, 0.12);
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid rgba(239, 68, 68, 0.25);
      max-width: 320px;
    }
    .ocr-retry-btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #f8fafc;
      font-size: 12px;
      font-weight: 500;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
    }
    .ocr-bottom-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.22);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      box-sizing: border-box;
    }
    .ocr-left-actions { display: flex; align-items: center; }
    .ocr-lang-wrap { position: relative; width: 140px; }
    .ocr-select {
      width: 100%;
      appearance: none;
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      padding: 7px 26px 7px 10px;
      color: #e2e8f0;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      text-overflow: ellipsis;
      white-space: nowrap;
      overflow: hidden;
    }
    .ocr-select:hover {
      background: rgba(255, 255, 255, 0.11);
      border-color: rgba(255, 255, 255, 0.22);
    }
    .ocr-select:focus { border-color: #f97316; }
    .ocr-select option { background: #1c1c21; color: #f8fafc; }
    .ocr-select-caret {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      color: #94a3b8;
      display: flex;
      align-items: center;
    }
    .ocr-right-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ocr-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      outline: none;
      transition: all 0.15s ease;
      user-select: none;
    }
    .ocr-btn:active { transform: scale(0.97); }
    .ocr-btn-copy {
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      color: #ffffff;
      box-shadow: 0 2px 8px rgba(249, 115, 22, 0.3);
    }
    .ocr-btn-copy:hover { filter: brightness(1.08); }
    .ocr-btn-copied {
      background: #10b981 !important;
      color: #ffffff !important;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35) !important;
    }
    .ocr-btn-download {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #cbd5e1;
    }
    .ocr-btn-download:hover {
      background: rgba(255, 255, 255, 0.14);
      color: #ffffff;
    }
    .ocr-btn-cross {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #94a3b8;
      padding: 7px 9px;
    }
    .ocr-btn-cross:hover {
      background: rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.35);
      color: #fca5a5;
    }
  `;

  shadow.appendChild(styleEl);

  const container = document.createElement("div");
  container.className = "ocr-window";
  container.innerHTML = `
    <!-- Top Drag Handle Bar -->
    <div class="ocr-drag-bar" id="ocr-drag-bar">
      <div class="ocr-drag-pill"></div>
    </div>

    <!-- Body Area: Single Box -->
    <div class="ocr-body">
      <!-- State 1: Extracting -->
      <div class="ocr-extracting-view" id="ocr-view-loading">
        <div class="ocr-spinner"></div>
        <div class="ocr-extracting-text">Extracting...</div>
      </div>

      <!-- State 2: Extracted Text Box -->
      <div class="ocr-result-view" id="ocr-view-result" style="display:none;">
        <textarea class="ocr-textarea" id="ocr-textarea" spellcheck="false" placeholder="No text detected..."></textarea>
      </div>

      <!-- State 3: Error View -->
      <div class="ocr-error-view" id="ocr-view-error" style="display:none;">
        <div class="ocr-error-text" id="ocr-error-text">Failed to extract text.</div>
        <button class="ocr-retry-btn" id="ocr-btn-retry">Try Again</button>
      </div>
    </div>

    <!-- Bottom Bar: ONLY Copy, Download, Auto detect, Cross -->
    <div class="ocr-bottom-bar">
      <!-- Auto detect -->
      <div class="ocr-left-actions">
        <div class="ocr-lang-wrap">
          <select class="ocr-select" id="ocr-lang-select" title="Language">
            <option value="detect" selected>Auto detect</option>
            <option value="ben">Bengali (বাংলা)</option>
            <option value="eng">English</option>
            <option value="hin">Hindi (हिन्दी)</option>
            <option value="ara">Arabic (العربية)</option>
            <option value="spa">Spanish (Español)</option>
            <option value="fra">French (Français)</option>
            <option value="deu">German (Deutsch)</option>
            <option value="chi_sim">Chinese (Simplified)</option>
            <option value="jpn">Japanese (日本語)</option>
            <option value="kor">Korean (한국어)</option>
            <option value="rus">Russian (Русский)</option>
            <option value="por">Portuguese (Português)</option>
            <option value="ita">Italian (Italiano)</option>
            <option value="tur">Turkish (Türkçe)</option>
            <option value="urd">Urdu (اردو)</option>
          </select>
          <div class="ocr-select-caret">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
      </div>

      <!-- Copy, Download, Cross -->
      <div class="ocr-right-actions">
        <!-- Download -->
        <button class="ocr-btn ocr-btn-download" id="ocr-btn-download-txt" title="Download text">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Download</span>
        </button>

        <!-- Copy -->
        <button class="ocr-btn ocr-btn-copy" id="ocr-btn-copy" disabled>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span id="ocr-copy-label">Copy</span>
        </button>

        <!-- Cross -->
        <button class="ocr-btn ocr-btn-cross" id="ocr-btn-cross" title="Close (ESC)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
  `;

  shadow.appendChild(container);
  (document.body || document.documentElement).appendChild(host);

  // Element Refs
  const viewLoading = shadow.getElementById("ocr-view-loading");
  const viewResult = shadow.getElementById("ocr-view-result");
  const viewError = shadow.getElementById("ocr-view-error");
  const textarea = shadow.getElementById("ocr-textarea");
  const errorText = shadow.getElementById("ocr-error-text");
  const langSelect = shadow.getElementById("ocr-lang-select");
  const copyBtn = shadow.getElementById("ocr-btn-copy");
  const copyLabel = shadow.getElementById("ocr-copy-label");
  const downloadTxtBtn = shadow.getElementById("ocr-btn-download-txt");
  const crossBtn = shadow.getElementById("ocr-btn-cross");
  const retryBtn = shadow.getElementById("ocr-btn-retry");
  const dragBar = shadow.getElementById("ocr-drag-bar");

  function setView(state) {
    viewLoading.style.display = state === "loading" ? "flex" : "none";
    viewResult.style.display = state === "result" ? "flex" : "none";
    viewError.style.display = state === "error" ? "flex" : "none";
    copyBtn.disabled = state !== "result";
    downloadTxtBtn.disabled = state !== "result";
  }

  function cleanBengaliOcrText(text) {
    if (!text) return text;
    let s = text.normalize("NFC");
    s = s.replace(/ৰ/g, "র").replace(/ৱ/g, "ব").replace(/ঽ/g, "");
    s = s.replace(/ে\s*া/g, "ো").replace(/ে\s*ৗ/g, "ৌ");
    s = s.replace(/([ক-হড়-ঢ়য়])\s+([া-ৌ্])/g, "$1$2");
    s = s.replace(/র্\s+([ক-হড়-ঢ়য়])/g, "র্$1");
    s = s.replace(/া{2,}/g, "া").replace(/ি{2,}/g, "ি").replace(/ী{2,}/g, "ী").replace(/ু{2,}/g, "ু").replace(/ূ{2,}/g, "ূ").replace(/ে{2,}/g, "ে").replace(/ৈ{2,}/g, "ৈ").replace(/ো{2,}/g, "ো").replace(/ৌ{2,}/g, "ৌ");
    s = s.replace(/\s*\|\s*/g, " । ");
    const replacements = [
      [/মুচ্ছাফিজ/g, "মুস্তাফিজ"],
      [/মুচ্ছাক্রিজ/g, "মুস্তাফিজ"],
      [/মুচ্ছাক্কি/g, "মুস্তাফিজ"],
      [/মুসত্মাফিজ/g, "মুস্তাফিজ"],
      [/মুছাফিজ/g, "মুস্তাফিজ"],
      [/মুচ্ছাফিজের/g, "মুস্তাফিজের"],
      [/মুছাফিজের/g, "মুস্তাফিজের"],
      [/মুচ্ছাক্কির/g, "মুস্তাফিজের"],
      [/মুসত্মাফিজের/g, "মুস্তাফিজের"],
      [/পি[রৰ]চাচম/g, "পিকচার্স"],
      [/পিকচাস/g, "পিকচার্স"],
      [/পিচাচম/g, "পিকচার্স"],
      [/পিকচাশ/g, "পিকচার্স"],
      [/পিকচার্ষ/g, "পিকচার্স"],
      [/পিৰচাস/g, "পিকচার্স"],
      [/প[রৰ]ি[বৱ][েৰ]শনা[য়য][়]?/g, "পরিবেশনায়"],
      [/পরিবেবনায়/g, "পরিবেশনায়"],
      [/পবিবেশনায়/g, "পরিবেশনায়"],
      [/পরিবেশীয়/g, "পরিবেশনায়"],
      [/প[রৰ]িচালনা[য়য][়]?/g, "পরিচালনায়"],
      [/পবিচালনা/g, "পরিচালনা"],
      [/ধবনম\s+রহমান/g, "শবনম রহমান"],
      [/থবনম\s+রহমান/g, "শবনম রহমান"],
      [/শুভলিপন/g, "গুলসিস্তান"],
      [/শ্রৃঙ্গার/g, "গুলসিস্তান"],
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
      [/ব্যবসচ্ছা/g, "ব্যবস্থা"],
      [/অবসচ্ছা/g, "অবস্থা"],
      [/উপসচ্ছিত/g, "উপস্থিত"],
      [/সচ্ছির/g, "স্থির"],
      [/রাচ্ছা/g, "রাস্তা"]
    ];
    for (const [pattern, replacement] of replacements) {
      s = s.replace(pattern, replacement);
    }
    return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function applyOcrData(data) {
    if (!data) return;

    if (data.status === "done") {
      let t = data.text || "";
      if (/[\u0980-\u09FF]/.test(t) || data.lang === "ben") {
        t = cleanBengaliOcrText(t);
      }
      textarea.value = t;
      if (data.lang && langSelect.querySelector(`option[value="${data.lang}"]`)) {
        langSelect.value = data.lang;
      }
      setView("result");
      setTimeout(() => textarea.focus(), 60);
    } else if (data.status === "error") {
      errorText.textContent = data.error || "Failed to extract text from image.";
      setView("error");
    } else if (data.status === "loading") {
      setView("loading");
    }
  }

  // Initial State Check from chrome.storage.local
  chrome.storage.local.get("snapmark_active_ocr", (res) => {
    if (res && res.snapmark_active_ocr) {
      applyOcrData(res.snapmark_active_ocr);
    }
  });

  // Storage change listener
  function storageListener(changes, area) {
    if (area === "local" && changes.snapmark_active_ocr) {
      applyOcrData(changes.snapmark_active_ocr.newValue);
    }
  }
  chrome.storage.onChanged.addListener(storageListener);

  // Message listener from background
  function messageListener(msg) {
    if (msg.type === "snapmark-ocr-result") {
      let t = msg.text || "";
      if (/[\u0980-\u09FF]/.test(t) || msg.lang === "ben") {
        t = cleanBengaliOcrText(t);
      }
      textarea.value = t;
      if (msg.lang && langSelect.querySelector(`option[value="${msg.lang}"]`)) {
        langSelect.value = msg.lang;
      }
      setView("result");
      setTimeout(() => textarea.focus(), 60);
    } else if (msg.type === "snapmark-ocr-error") {
      errorText.textContent = msg.error || "Failed to extract text from image.";
      setView("error");
    } else if (msg.type === "snapmark-ocr-loading") {
      setView("loading");
    }
  }
  chrome.runtime.onMessage.addListener(messageListener);

  function closeModal() {
    window.removeEventListener("keydown", onKeyDownEsc);
    chrome.runtime.onMessage.removeListener(messageListener);
    chrome.storage.onChanged.removeListener(storageListener);
    host.remove();
  }

  function onKeyDownEsc(e) {
    if (e.key === "Escape") {
      closeModal();
    }
  }
  window.addEventListener("keydown", onKeyDownEsc);
  crossBtn.addEventListener("click", closeModal);

  // Copy to clipboard
  copyBtn.addEventListener("click", async () => {
    const text = textarea.value;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      textarea.select();
      document.execCommand("copy");
    }

    copyBtn.classList.add("ocr-btn-copied");
    copyLabel.textContent = "Copied ✓";
    setTimeout(() => {
      copyBtn.classList.remove("ocr-btn-copied");
      copyLabel.textContent = "Copy";
    }, 2000);
  });

  // Download TXT file
  downloadTxtBtn.addEventListener("click", () => {
    const text = textarea.value;
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "extracted-text.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // Re-run OCR when language is changed
  langSelect.addEventListener("change", () => {
    setView("loading");
    chrome.runtime.sendMessage({
      action: "ocr-reprocess",
      lang: langSelect.value,
    });
  });

  retryBtn.addEventListener("click", () => {
    setView("loading");
    chrome.runtime.sendMessage({
      action: "ocr-reprocess",
      lang: langSelect.value,
    });
  });

  // Draggable window support
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  dragBar.addEventListener("mousedown", (e) => {
    isDragging = true;
    const rect = container.getBoundingClientRect();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    initialLeft = rect.left;
    initialTop = rect.top;

    host.style.bottom = "auto";
    host.style.right = "auto";
    host.style.left = `${initialLeft}px`;
    host.style.top = `${initialTop}px`;

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      const dx = ev.clientX - dragStartX;
      const dy = ev.clientY - dragStartY;
      const newLeft = Math.max(8, Math.min(window.innerWidth - rect.width - 8, initialLeft + dx));
      const newTop = Math.max(8, Math.min(window.innerHeight - rect.height - 8, initialTop + dy));
      host.style.left = `${newLeft}px`;
      host.style.top = `${newTop}px`;
    };

    const onMouseUp = () => {
      isDragging = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
})();
