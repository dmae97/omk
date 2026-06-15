const HOST_NAME = "io.omk.web_bridge";
const SCHEMA_VERSION = 1;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "OMK_WEB_BRIDGE_CAPTURE") return false;
  captureActiveTab(Boolean(message.includeScreenshot))
    .then((snapshot) => sendToNativeHost(snapshot))
    .then((response) => sendResponse({ ok: true, response }))
    .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
  return true;
});

async function captureActiveTab(includeScreenshot) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) throw new Error("No active tab is available");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-script.js"] });
  const [page] = await chrome.tabs.sendMessage(tab.id, { type: "OMK_WEB_BRIDGE_COLLECT_PAGE" });
  let screenshot;
  if (includeScreenshot) {
    const bytes = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    screenshot = { mimeType: "image/png", bytes, redacted: false };
  }
  return sanitizeSnapshot({
    tab: { id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title, active: tab.active },
    tabs: [{ id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title, active: true }],
    ...page,
    screenshot,
    metadata: {
      ...page.metadata,
      url: tab.url,
      title: tab.title,
      capturedAt: new Date().toISOString(),
      source: "chrome-extension"
    }
  });
}

function sendToNativeHost(snapshot) {
  return chrome.runtime.sendNativeMessage(HOST_NAME, {
    schemaVersion: SCHEMA_VERSION,
    requestId: `extension-${Date.now()}`,
    method: "orchestration.context.write",
    params: { snapshot }
  });
}

function sanitizeSnapshot(snapshot) {
  const forbidden = /(cookie|authorization|password|token|secret|localStorage|sessionStorage|indexedDB)/gi;
  const scrubText = (value) => typeof value === "string" ? value.replace(forbidden, "[redacted]").slice(0, 120000) : value;
  return JSON.parse(JSON.stringify(snapshot, (key, value) => {
    forbidden.lastIndex = 0;
    if (forbidden.test(key)) return "[redacted]";
    forbidden.lastIndex = 0;
    if (typeof value === "string") return scrubText(value);
    return value;
  }));
}
