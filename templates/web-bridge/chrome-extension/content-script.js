chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "OMK_WEB_BRIDGE_COLLECT_PAGE") return false;
  sendResponse(collectPageContext());
  return false;
});

function collectPageContext() {
  const clone = document.documentElement.cloneNode(true);
  scrubDom(clone);
  const selectedText = String(window.getSelection ? window.getSelection() : "");
  const description = document.querySelector('meta[name="description"]')?.getAttribute("content") || undefined;
  return {
    metadata: {
      url: location.href,
      title: document.title,
      description,
      language: document.documentElement.lang || undefined,
      contentType: document.contentType,
      source: "chrome-extension"
    },
    text: safeText(document.body?.innerText || ""),
    selectedText: safeText(selectedText),
    dom: safeText(clone.outerHTML)
  };
}

function scrubDom(root) {
  root.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
  root.querySelectorAll("input, textarea, select").forEach((node) => {
    node.removeAttribute("value");
    node.removeAttribute("checked");
    node.removeAttribute("selected");
    if (String(node.getAttribute("type") || "").toLowerCase() === "password") {
      node.setAttribute("data-omk-redacted", "password");
    }
  });
  root.querySelectorAll("[data-token], [data-secret], [data-password]").forEach((node) => {
    node.setAttribute("data-omk-redacted", "secret-like-attribute");
  });
}

function safeText(value) {
  return String(value)
    .replace(/\b(cookie|set-cookie|authorization|password|token|secret|localStorage|sessionStorage|indexedDB)\b\s*[:=]?\s*[^\n\r;]*/gi, "$1: [redacted]")
    .slice(0, 120000);
}
