document.getElementById("capture").addEventListener("click", async () => {
  const status = document.getElementById("status");
  status.textContent = "Capturing active tab...";
  const includeScreenshot = document.getElementById("screenshot").checked;
  const response = await chrome.runtime.sendMessage({ type: "OMK_WEB_BRIDGE_CAPTURE", includeScreenshot });
  status.textContent = response && response.ok
    ? "Sent sanitized page context to OMK."
    : `Bridge unavailable: ${response && response.error ? response.error : "unknown error"}`;
});
