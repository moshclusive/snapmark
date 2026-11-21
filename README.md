# Snapmark - Smart Screenshot & Annotation Studio

**Snapmark** is an advanced browser extension built with Manifest V3 for full-page screenshot capture, annotation, and vector PDF export. Capture, annotation, and export run fully offline on your machine — no telemetry, no ads. The optional OCR feature sends the image to the OCR service you choose (see Privacy below).

---

## 🚀 How to Install in Chrome / Edge / Brave

1. Open your Chromium browser (Chrome, Edge, Brave, Opera, etc.).
2. Navigate to `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** in the top-left corner.
5. Select the folder: the folder where you extracted Snapmark.
6. Pin **Snapmark** to your browser toolbar and start capturing!

---

## ✨ Features & Capabilities

### 📸 Capture Modes
- ⚡ **Capture entire page + Save as PDF (`Ctrl+Shift+S`)**: Automatically scrolls, stitches, and converts the whole page into a high-DPI vector PDF download in one click.
- 📄 **Capture entire page (`Ctrl+Shift+E`)**: Intelligently detects inner scrollable containers (ChatGPT, Claude, Notion, social feeds) or standard documents, hides duplicate sticky headers during scrolling, stitches via `OffscreenCanvas`, and opens directly in the Snapmark Studio.
- 🪟 **Capture visible part (`Ctrl+Shift+V`)**: Instant viewport capture rendered at native Device Pixel Ratio.
- ✂ **Capture selection (`Alt+Shift+4`)**:
  - Interactive on-screen selection with precision crosshairs, dimmed backdrop, and live pixel dimensions badge.
  - **Ctrl Key Hold**: Holding <kbd>Ctrl</kbd> while dragging constrains the selection to a **1:1 aspect ratio (perfect square)**.
  - <kbd>ESC</kbd> cancels cleanly without residue.
- 💻 **Capture browser window**: Viewport capture wrapped with an authentic macOS (traffic lights) or Windows 11 browser frame mockup.

### 🎨 Smart Annotation Studio (Modern Dark Aesthetic)
The old, outdated "Save Screenshot" window is replaced with a comprehensive studio:
- **Text / Image Selection & Copy**:
  - **Webpage Text Layer**: Highlights real DOM text directly from the screenshot so you can select and copy text (<kbd>Ctrl+C</kbd>).
  - **Area Snip & Copy (<kbd>X</kbd>)**: Drag a box on the screenshot to instantly copy just that cropped area to your clipboard or download as a standalone snippet.
- **Add Text (<kbd>Shift+T</kbd>)**: Click anywhere to write text with customizable font size, contrast background pill, and color.
- **Pen (<kbd>P</kbd>)**: Smooth freehand pen with variable line thickness.
- **Highlighter (<kbd>H</kbd>)**: Semi-transparent neon marker that highlights key lines without concealing text.
- **Shapes**: Straight line, dashed line, rectangle (outline & filled), circle/ellipse (outline & filled). Hold <kbd>Shift</kbd> for perfect squares and circles.
- **Arrows (<kbd>A</kbd>)**: Single-headed arrow, double-headed arrow, and curved Bézier arrow with draggable midpoint.
- **Numbering Badges (<kbd>N</kbd>)**: Sequential step markers (`1`, `2`, `3`...) with automatic auto-incrementing on each click. Auto-adjusts text contrast.
- **Blur / Redact (<kbd>B</kbd>)**: Pixelate passwords, API keys, emails, or personal information with zero trace.
- **Spotlight Focus (<kbd>S</kbd>)**: Dims and blurs everything outside the selected focal region (<kbd>rgba(0,0,0,0.65)</kbd>), drawing full visual attention onto your chosen subject with a luminous cyan border!
- **Eraser (<kbd>E</kbd>) & Clear All**: Delete individual annotations or clear all with one click.
- **Color Presets & Custom Picker**: 8 modern preset colors + standard HTML5 color picker for any custom hue.
- **Stroke Width**: 4 quick presets (2px, 4px, 8px, 14px) or mouse-wheel scrolling for live dynamic width adjustment.
- **Crop (<kbd>C</kbd>)**: 4-side and 4-corner interactive handles with Apply/Cancel.
- **Layers Panel (<kbd>L</kbd>)**: View all annotations, toggle eye visibility, and delete layers.
- **Undo (<kbd>Ctrl+Z</kbd>) & Redo (<kbd>Ctrl+Y</kbd>)**: Complete history undo/redo stack.

---

## 🎨 Open with Photoshop Integration

Clicking the **Photoshop** button in the top navigation bar:
1. Copies the full-resolution screenshot with annotations directly to the OS clipboard.
2. Saves the image to disk and launches Adobe Photoshop automatically via Windows file association.
3. If Photoshop is closed: Windows launches Photoshop with the image file.
4. If Photoshop is open: Simply press <kbd>Ctrl+V</kbd> to paste the capture onto any active document, canvas, or artboard!
5. Also provides a **Download Photoshop Script (.jsx)** button for automated artboard creation using Photoshop's ExtendScript engine.

---

## ⌨ Keyboard Shortcuts Reference

| Shortcut | Action |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> | Capture entire page & Save as PDF |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>E</kbd> | Capture entire page |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>V</kbd> | Capture visible part |
| <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>4</kbd> | Capture custom selection |
| <kbd>Ctrl</kbd> (Hold while selecting) | Lock selection to 1:1 Square |
| <kbd>Ctrl</kbd> (Hold on popup click) | Copy capture directly to clipboard |
| <kbd>Alt</kbd> (Hold on popup click) | 3-Second delayed capture with countdown |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Y</kbd> | Undo / Redo annotation |
| <kbd>Del</kbd> / <kbd>Backspace</kbd> | Delete selected annotation |
| <kbd>V</kbd>, <kbd>P</kbd>, <kbd>H</kbd>, <kbd>R</kbd>, <kbd>O</kbd>, <kbd>A</kbd>, <kbd>N</kbd>, <kbd>B</kbd>, <kbd>S</kbd>, <kbd>E</kbd>, <kbd>X</kbd>, <kbd>C</kbd>, <kbd>L</kbd> | Tool shortcuts |

---

## 📁 File Structure

```
the Snapmark folder\
├── manifest.json         # Manifest V3 extension configuration
├── background.js        # Background service worker & stitching engine
├── popup.html           # Cool modern popup menu
├── popup.css            # Dark glassmorphic popup styling
├── popup.js             # Popup interaction & shortcuts
├── editor.html          # Snapmark Studio annotation workspace
├── editor.css           # Studio styling, toolbar, modals, frames
├── editor.js            # Annotation logic, canvas rendering, tools, exports
├── selection.js         # Injected selection script with Ctrl 1:1 lock
├── selection.css        # Selection overlay styling & dimensions badge
├── shared.js            # PDF builder, binary encoding, Photoshop script
├── icons/               # 16, 32, 48, 128 px custom icons
```

> **OCR privacy:** OCR is the only feature that sends data off your machine. It uploads the screenshot to the OCR provider (copytextfrompicture.xyz by default, with OCR.space as fallback). If the image is sensitive, skip OCR or redact it first.
> **OCR API key:** Snapmark ships with OCR.space's public demo key (`helloworld`), which is rate-limited. For regular OCR use, get a free key at https://ocr.space/ocrapi/freekey and set it in the extension settings.
