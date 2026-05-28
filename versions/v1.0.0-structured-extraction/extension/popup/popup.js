// Popup UI logic

const $ = (s) => document.querySelector(s);

const captureBtn = $("#captureBtn");
const autoToggle = $("#autoToggle");
const openUiBtn = $("#openUiBtn");
const statusDot = $("#statusDot");
const statusText = $("#statusText");
const lastCaptureEl = $("#lastCapture");

// ---- Init ----

chrome.runtime.sendMessage({ action: "getStatus" }, (resp) => {
  if (!resp) return;
  autoToggle.checked = resp.autoCapture;
  updateServerStatus(resp.serverOnline);
});

// ---- Server status ----

function updateServerStatus(online) {
  statusDot.className = "status-dot " + (online ? "on" : "off");
  statusText.textContent = online ? "在线" : "离线";
}

// ---- Capture ----

captureBtn.addEventListener("click", () => {
  captureBtn.disabled = true;
  captureBtn.textContent = "捕获中...";

  chrome.runtime.sendMessage({ action: "captureNow" }, (resp) => {
    captureBtn.disabled = false;
    captureBtn.textContent = "立即捕获当前对话";

    if (!resp) {
      lastCaptureEl.textContent = "无法连接到内容脚本，请刷新页面";
      return;
    }
    if (resp.ok) {
      const now = new Date().toLocaleTimeString("zh-CN");
      lastCaptureEl.textContent = `${now} — 捕获了 ${resp.count} 条消息`;
    } else {
      lastCaptureEl.textContent = "未检测到新消息: " + (resp.error || "");
    }
  });
});

// ---- Auto-capture toggle ----

autoToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    action: "setAutoCapture",
    enabled: autoToggle.checked,
  });
});

// ---- Open UI ----

openUiBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "http://localhost:8765" });
});

// Periodically refresh server status
setInterval(() => {
  fetch("http://localhost:8765/api/dates")
    .then((r) => updateServerStatus(r.ok))
    .catch(() => updateServerStatus(false));
}, 5000);
