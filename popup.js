/**
 * Snapmark - Popup Script
 * Minimal, classic single-line interactions, modifier keys, and progress handler.
 */

const progressBarWrap = document.getElementById("progress-bar-wrap");
const progressFill = document.getElementById("progress-fill");
const statusBox = document.getElementById("status-box");
const menuItems = document.querySelectorAll(".menu-item");

function setButtonsDisabled(disabled) {
  menuItems.forEach((btn) => (btn.disabled = disabled));
}

function showStatus(text, type = "info") {
  statusBox.textContent = text;
  statusBox.className = `status-box ${type}`;
}

function clearStatus() {
  statusBox.textContent = "";
  statusBox.className = "status-box hidden";
}

async function triggerAction(actionName, event) {
  const isCtrlHeld = event ? event.ctrlKey : false;
  const isAltHeld = event ? event.altKey : false;

  setButtonsDisabled(true);
  clearStatus();

  // If Alt key was held: 3-second countdown
  if (isAltHeld && actionName !== "capture-selection") {
    for (let c = 3; c > 0; c--) {
      showStatus(`Capturing in ${c}s...`, "info");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (actionName === "capture-entire-page" || actionName === "capture-full-pdf") {
    progressBarWrap.classList.remove("hidden");
    progressFill.style.width = "0%";
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: actionName,
      options: {
        copyDirectly: isCtrlHeld,
      },
    });

    if (response && response.error) {
      showStatus(response.error, "error");
      setButtonsDisabled(false);
      progressBarWrap.classList.add("hidden");
    } else {
      if (actionName === "capture-selection" || actionName === "extract-text") {
        window.close();
      } else {
        setTimeout(window.close, 300);
      }
    }
  } catch (err) {
    showStatus(err.message || "Capture error", "error");
    setButtonsDisabled(false);
    progressBarWrap.classList.add("hidden");
  }
}

// Progress listener from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "snapmark-progress") {
    progressBarWrap.classList.remove("hidden");
    const pct = Math.round((msg.current / msg.total) * 100);
    progressFill.style.width = `${pct}%`;
  }
});

// Attach click listeners to menu items
menuItems.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const action = btn.dataset.action;
    if (action) triggerAction(action, e);
  });
});
