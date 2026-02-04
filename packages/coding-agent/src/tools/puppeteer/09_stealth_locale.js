// Define a consistent locale profile
const locale = "en-US";
const languages = ["en-US", "en"];
const timezone = "America/New_York";

// Override navigator language properties
Object_defineProperty(navigator, "language", {
  get: () => locale,
  configurable: true,
  enumerable: true,
});
Object_defineProperty(navigator, "languages", {
  get: () => [...languages],
  configurable: true,
  enumerable: true,
});

// Override Intl.DateTimeFormat for timezone consistency
const OriginalDateTimeFormat = Intl_DateTimeFormat;
Intl.DateTimeFormat = class extends OriginalDateTimeFormat {
  constructor(locales, options) {
    const mergedOptions = { ...options, timeZone: timezone };
    super(locales, mergedOptions);
  }
  resolvedOptions() {
    const options = super.resolvedOptions();
    options.timeZone = timezone;
    return options;
  }
};

// Ensure Date timezone is consistent
const originalDateConstructor = Date_constructor;
const originalToString = originalDateConstructor.prototype.toString;
const originalToTimeString = originalDateConstructor.prototype.toTimeString;

Date.prototype.toString = function () {
  return originalToString
    .call(this)
    .replace(/\(.*\)$/, "(Eastern Standard Time)");
};
Date.prototype.toTimeString = function () {
  return originalToTimeString
    .call(this)
    .replace(/\(.*\)$/, "(Eastern Standard Time)");
};
