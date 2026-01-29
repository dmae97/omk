/**
 * Types for image worker communication.
 */

export type ImageRequest =
	| { type: "init"; id: number }
	| { type: "destroy" }
	| {
			type: "load";
			id: number;
			/** Image bytes (transferred, not copied) */
			bytes: Uint8Array;
	  }
	| {
			type: "resize";
			id: number;
			/** Handle returned from load */
			handle: number;
			width: number;
			height: number;
			filter: number;
	  }
	| {
			type: "get_dimensions";
			id: number;
			handle: number;
	  }
	| {
			type: "get_png";
			id: number;
			handle: number;
	  }
	| {
			type: "get_jpeg";
			id: number;
			handle: number;
			quality: number;
	  }
	| {
			type: "free";
			id: number;
			handle: number;
	  };

export type ImageResponse =
	| { type: "ready"; id: number }
	| { type: "error"; id: number; error: string }
	| { type: "loaded"; id: number; handle: number; width: number; height: number }
	| { type: "resized"; id: number; handle: number; width: number; height: number }
	| { type: "dimensions"; id: number; width: number; height: number }
	| { type: "bytes"; id: number; bytes: Uint8Array }
	| { type: "freed"; id: number };
