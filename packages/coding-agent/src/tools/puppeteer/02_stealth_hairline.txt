const elementDescriptor = Object_getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
Object_defineProperty(HTMLDivElement.prototype, "offsetHeight", {
  ...elementDescriptor,
  get: function () {
    if (this.id === "modernizr") return 1;
    return elementDescriptor.get.apply(this);
  },
});
