/**
 * Image processing via native bindings.
 */

import { native } from "../native";

export { ImageFormat, type PhotonImageConstructor, SamplingFilter } from "./types";

/** PhotonImage class for image manipulation. Use PhotonImage.parse() to create instances. */
export const PhotonImage = native.PhotonImage;

/** Encode image bytes into a SIXEL escape sequence at target pixel size. */
export const encodeSixel = native.encodeSixel;

/** PhotonImage instance type. */
export type PhotonImage = import("./types").PhotonImage;
