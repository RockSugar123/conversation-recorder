// Background service worker — relays messages, manages auto-capture timer.

const SERVER_URL = "http://localhost:8765";
const CONTENT_SCRIPT = "content.js";

let autoCaptureTimer = null;
let autoCaptureIntervalMs = 10000;

// Check server health
async function checkServer() {
  try {
    const res = await fetch(`${SERVER_URL}/api/dates`);
    return res.ok;
  } catch (_) {
    return false;
  }
}

// Ensure content script is loaded in a tab, inject it dynamically if not
async function ensureContentScript(tabId) {
  try {
    // Try sending a ping to see if content script is already there
    const resp = await chrome.tabs.sendMessage(tabId, { action: "ping" });
    if (resp && resp.ready) return true;
  } catch (_) {
    // Not loaded — inject dynamically
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT],
    });
    // Small delay to let the script initialize
    await new Promise((r) => setTimeout(r, 100));
    return true;
  } catch (err) {
    console.warn("[AI Recorder] Cannot inject content script:", err.message);
    return false;
  }
}

// Perform capture on the active tab
async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return { ok: false, error: "No active tab" };

  // Skip restricted URLs (chrome://, edge://, about:, etc.)
  if (tab.url && !tab.url.startsWith("http")) {
    return { ok: false, error: "此页面不支持捕获" };
  }

  const ready = await ensureContentScript(tab.id);
  if (!ready) return { ok: false, error: "无法在此页面注入脚本" };

  try {
    const result = await chrome.tabs.sendMessage(tab.id, { action: "capture" });
    return result || { ok: false, count: 0 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Start periodic capture
function startAutoCapture() {
  if (autoCaptureTimer) return;
  autoCaptureTimer = setInterval(async () => {
    const result = await captureActiveTab();
    if (!result.ok) {
      console.log("[AI Recorder] Auto-capture skipped:", result.error);
    }
  }, autoCaptureIntervalMs);
}

function stopAutoCapture() {
  if (autoCaptureTimer) {
    clearInterval(autoCaptureTimer);
    autoCaptureTimer = null;
  }
}

// Listen for popup messages
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "captureNow") {
    captureActiveTab().then(sendResponse);
    return true;
  }

  if (msg.action === "setAutoCapture") {
    if (msg.enabled) {
      startAutoCapture();
    } else {
      stopAutoCapture();
    }
    chrome.storage.local.set({ autoCapture: msg.enabled });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "getStatus") {
    chrome.storage.local.get(["autoCapture"], (data) => {
      checkServer().then((serverOnline) => {
        sendResponse({
          autoCapture: !!data.autoCapture,
          serverOnline,
        });
      });
    });
    return true;
  }
});

// Restore auto-capture state on startup
chrome.storage.local.get(["autoCapture"], (data) => {
  if (data.autoCapture) {
    startAutoCapture();
  }
});
