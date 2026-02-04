const commonFonts = [
  "Arial",
  "Arial Black",
  "Arial Narrow",
  "Arial Rounded MT Bold",
  "Book Antiqua",
  "Bookman Old Style",
  "Calibri",
  "Cambria",
  "Cambria Math",
  "Century",
  "Century Gothic",
  "Century Schoolbook",
  "Comic Sans MS",
  "Consolas",
  "Courier",
  "Courier New",
  "Garamond",
  "Geneva",
  "Georgia",
  "Gill Sans",
  "Gill Sans MT",
  "Helvetica",
  "Helvetica Neue",
  "Impact",
  "Lucida Console",
  "Lucida Grande",
  "Lucida Sans Unicode",
  "MS Gothic",
  "MS PGothic",
  "MS Sans Serif",
  "MS Serif",
  "Palatino",
  "Palatino Linotype",
  "Segoe Print",
  "Segoe Script",
  "Segoe UI",
  "Segoe UI Emoji",
  "Segoe UI Symbol",
  "Tahoma",
  "Times",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Wingdings",
  "Wingdings 2",
  "Wingdings 3",
  "Apple Color Emoji",
  "Apple SD Gothic Neo",
  "Helvetica Neue",
  "Hoefler Text",
  "Menlo",
  "Monaco",
  "San Francisco",
  "SF Pro Display",
  "SF Pro Text",
];

// Override queryLocalFonts if present (Local Font Access API)
if ("queryLocalFonts" in window) {
  Object_defineProperty(window, "queryLocalFonts", {
    value: async () => {
      return commonFonts.map((family) => ({
        family,
        fullName: family,
        postscriptName: family.replace(/\s+/g, ""),
        style: "Regular",
        blob: () => Promise_resolve(new Window_Blob([])),
      }));
    },
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

// Hide fonts-unique tracking via canvas
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, options) {
  const ctx = originalGetContext.call(this, type, options);
  if (ctx && type === "2d") {
    const originalFillText = ctx.fillText;
    ctx.fillText = function (text, x, y, maxWidth) {
      // Add tiny imperceptible noise to text rendering
      const noiseX = (Math_random() - 0.5) * 0.02;
      const noiseY = (Math_random() - 0.5) * 0.02;
      return originalFillText.call(
        this,
        text,
        x + noiseX,
        y + noiseY,
        maxWidth,
      );
    };
  }
  return ctx;
};
