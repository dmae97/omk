const navigatorProto = Object_getPrototypeOf(navigator);
if (navigatorProto && "hardwareConcurrency" in navigatorProto) {
	Object_defineProperty(navigatorProto, "hardwareConcurrency", {
		get: () => 4,
		configurable: true,
		enumerable: true,
	});
}
