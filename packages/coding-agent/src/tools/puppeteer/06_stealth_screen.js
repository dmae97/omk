// Generate consistent "real" screen dimensions based on viewport
const width = window.innerWidth;
const height = window.innerHeight;
const availWidth = width;
const availHeight = Math_max(height - 40, 0); // Account for taskbar
const colorDepth = 24;
const pixelDepth = 24;
const devicePixelRatio = window.devicePixelRatio && window.devicePixelRatio > 1 ? window.devicePixelRatio : 1.25;

const defineScreenProp = (prop, value) => {
  try {
    Object_defineProperty(window.Screen?.prototype ?? window.screen, prop, {
      get: () => value,
      configurable: true,
      enumerable: true,
    });
  } catch {}
};

// Override screen properties
for (const [prop, descriptor] of Object_entries({
  width,
  height,
  availWidth,
  availHeight,
  availLeft: 0,
  availTop: 0,
  colorDepth,
  pixelDepth,
})) {
  defineScreenProp(prop, descriptor);
}

// Ensure outer dimensions match screen for consistency
const chromeFrameHeight = 85;
Object_defineProperty(window, "outerWidth", {
  get: () => window.innerWidth,
  configurable: true,
  enumerable: true,
});
Object_defineProperty(window, "outerHeight", {
  get: () => window.innerHeight + chromeFrameHeight,
  configurable: true,
  enumerable: true,
});

if (window.visualViewport) {
  const defineVvpProp = (prop, value) => {
    try {
      Object_defineProperty(window.visualViewport, prop, {
        get: () => value,
        configurable: true,
        enumerable: true,
      });
    } catch {}
  };

  defineVvpProp("width", width);
  defineVvpProp("height", height);
  defineVvpProp("scale", 1);
  defineVvpProp("offsetLeft", 0);
  defineVvpProp("offsetTop", 0);
  defineVvpProp("pageLeft", 0);
  defineVvpProp("pageTop", 0);
}

// Consistent devicePixelRatio
Object_defineProperty(window, "devicePixelRatio", {
  get: () => devicePixelRatio,
  configurable: true,
  enumerable: true,
});
