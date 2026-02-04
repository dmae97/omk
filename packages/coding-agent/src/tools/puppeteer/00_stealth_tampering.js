// Helper to generate native code string
const makeNativeString = (name) =>
  "function " + (name || "") + "() { [native code] }";

// Patch toString for common fingerprinted functions
const patchedFns = [
  [window.alert, "alert"],
  [window.prompt, "prompt"],
  [window.confirm, "confirm"],
  [window.fetch, "fetch"],
  [window.XMLHttpRequest, "XMLHttpRequest"],
  [window.WebSocket, "WebSocket"],
  [window.localStorage?.getItem, "getItem"],
  [window.localStorage?.setItem, "setItem"],
  [window.navigator.geolocation?.getCurrentPosition, "getCurrentPosition"],
  [window.navigator.geolocation?.watchPosition, "watchPosition"],
  [window.CanvasRenderingContext2D?.prototype.getImageData, "getImageData"],
  [window.HTMLCanvasElement?.prototype.toDataURL, "toDataURL"],
  [window.HTMLCanvasElement?.prototype.toBlob, "toBlob"],
];

for (const [fn, name] of patchedFns) {
  if (typeof fn === "function") {
    const nativeStr = makeNativeString(name);
    Object_defineProperty(fn, "toString", {
      value: function toString() { return nativeStr; },
      writable: false,
      configurable: true,
      enumerable: false,
    });
  }
}

// Patch Object.getOwnPropertyDescriptor to return native-looking descriptors
Object.getOwnPropertyDescriptor = function (obj, prop) {
  const descriptor = Object_getOwnPropertyDescriptor.call(this, obj, prop);
  if (!descriptor) return descriptor;

  // Make patched descriptors look native
  if (descriptor.get && typeof descriptor.get === "function") {
    const getStr = makeNativeString("get " + String(prop));
    Object_defineProperty(descriptor.get, "toString", {
      value: function toString() { return getStr; },
      writable: false,
      configurable: true,
      enumerable: false,
    });
  }
  if (descriptor.set && typeof descriptor.set === "function") {
    const setStr = makeNativeString("set " + String(prop));
    Object_defineProperty(descriptor.set, "toString", {
      value: function toString() { return setStr; },
      writable: false,
      configurable: true,
      enumerable: false,
    });
  }

  return descriptor;
};

// Cleanup
document.head.removeChild(iframe);
