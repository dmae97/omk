import test from "node:test";
import assert from "node:assert/strict";

import {
  isTextPart,
  isThinkPart,
  isImageURLPart,
  isAudioURLPart,
  isVideoURLPart,
  isWireEventMessage,
  isDisplayBlock,
} from "../../dist/adapters/kimi/wire-protocol-types.js";

test("ContentPart type guards", () => {
  assert.equal(isTextPart({ type: "text", text: "hello" }), true);
  assert.equal(isTextPart({ type: "think", think: "hmm" }), false);

  assert.equal(isThinkPart({ type: "think", think: "hmm" }), true);
  assert.equal(isThinkPart({ type: "text", text: "hello" }), false);

  assert.equal(isImageURLPart({ type: "image_url", image_url: { url: "http://example.com/img.png" } }), true);
  assert.equal(isImageURLPart({ type: "text", text: "hello" }), false);

  assert.equal(isAudioURLPart({ type: "audio_url", audio_url: { url: "http://example.com/audio.mp3" } }), true);
  assert.equal(isAudioURLPart({ type: "text", text: "hello" }), false);

  assert.equal(isVideoURLPart({ type: "video_url", video_url: { url: "http://example.com/video.mp4" } }), true);
  assert.equal(isVideoURLPart({ type: "text", text: "hello" }), false);
});

test("isWireEventMessage validates shape", () => {
  assert.equal(isWireEventMessage({ type: "ContentPart", payload: {} }), true);
  assert.equal(isWireEventMessage({ type: "TurnBegin", payload: { user_input: "hi" } }), true);
  assert.equal(isWireEventMessage(null), false);
  assert.equal(isWireEventMessage({}), false);
  assert.equal(isWireEventMessage({ type: "x" }), false);
});

test("isDisplayBlock validates shape", () => {
  assert.equal(isDisplayBlock({ type: "brief", text: "hello" }), true);
  assert.equal(isDisplayBlock({ type: "diff", path: "a.ts", old_text: "a", new_text: "b" }), true);
  assert.equal(isDisplayBlock(null), false);
  assert.equal(isDisplayBlock({}), false);
});
