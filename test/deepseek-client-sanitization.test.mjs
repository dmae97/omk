import test from "node:test";
import assert from "node:assert/strict";

// Test the extractTextContent logic directly (extracted from DeepSeekClient)
function extractTextContent(content) {
  if (typeof content === "string") return content.trim();
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part.trim();
        if (part && typeof part === "object" && "text" in part) {
          const textPart = part;
          return typeof textPart.text === "string" ? textPart.text.trim() : "";
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .join(" ");
  }
  // Fallback: coerce to string
  return String(content ?? "").trim();
}

// Test the sanitization logic (extracted from DeepSeekClient.buildRequestBody)
function sanitizeMessages(messages) {
  const sanitizedMessages = messages
    .map((msg) => ({
      ...msg,
      content: extractTextContent(msg.content),
    }))
    .filter((msg) => msg.content.length > 0);

  if (sanitizedMessages.length === 0) {
    sanitizedMessages.push({ role: "user", content: "[omk] Continue with the task." });
  }

  return sanitizedMessages;
}

test("extractTextContent handles string content", () => {
  assert.equal(extractTextContent("Hello World"), "Hello World");
  assert.equal(extractTextContent("  trimmed  "), "trimmed");
  assert.equal(extractTextContent(""), "");
  assert.equal(extractTextContent("   "), "");
});

test("extractTextContent handles null/undefined", () => {
  assert.equal(extractTextContent(null), "");
  assert.equal(extractTextContent(undefined), "");
});

test("extractTextContent handles array of strings", () => {
  assert.equal(extractTextContent(["Hello", "World"]), "Hello World");
  assert.equal(extractTextContent(["  trimmed  ", "  also  "]), "trimmed also");
  assert.equal(extractTextContent(["", ""]), "");
  assert.equal(extractTextContent([]), "");
});

test("extractTextContent handles array of text parts", () => {
  assert.equal(
    extractTextContent([{ type: "text", text: "Hello" }, { type: "text", text: "World" }]),
    "Hello World"
  );
  assert.equal(
    extractTextContent([{ type: "text", text: "  trimmed  " }]),
    "trimmed"
  );
  assert.equal(
    extractTextContent([{ type: "text", text: "" }]),
    ""
  );
  assert.equal(
    extractTextContent([{ type: "text", text: null }]),
    ""
  );
});

test("extractTextContent handles mixed array formats", () => {
  assert.equal(
    extractTextContent(["Hello", { type: "text", text: "World" }]),
    "Hello World"
  );
  assert.equal(
    extractTextContent([{ type: "text", text: "Hello" }, "World"]),
    "Hello World"
  );
});

test("extractTextContent handles edge cases", () => {
  // Non-string, non-array, non-null
  assert.equal(extractTextContent(123), "123");
  assert.equal(extractTextContent(true), "true");
  assert.equal(extractTextContent({}), "[object Object]");
  
  // Array with non-text objects
  assert.equal(extractTextContent([{ type: "image", url: "http://example.com" }]), "");
  assert.equal(extractTextContent([{ foo: "bar" }]), "");
});

test("sanitizeMessages filters empty messages", () => {
  const messages = [
    { role: "system", content: "Hello" },
    { role: "user", content: "" },
    { role: "assistant", content: "   " },
  ];
  const result = sanitizeMessages(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].content, "Hello");
});

test("sanitizeMessages adds fallback when all messages empty", () => {
  const messages = [
    { role: "system", content: "" },
    { role: "user", content: "   " },
  ];
  const result = sanitizeMessages(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "user");
  assert.equal(result[0].content, "[omk] Continue with the task.");
});

test("sanitizeMessages handles array content format", () => {
  const messages = [
    {
      role: "system",
      content: [
        { type: "text", text: "You are a helpful assistant." },
        { type: "text", text: "Be concise." },
      ],
    },
    { role: "user", content: "Hello" },
  ];
  const result = sanitizeMessages(messages);
  assert.equal(result.length, 2);
  assert.equal(result[0].content, "You are a helpful assistant. Be concise.");
  assert.equal(result[1].content, "Hello");
});

test("sanitizeMessages handles empty array content", () => {
  const messages = [
    { role: "system", content: [] },
    { role: "user", content: "Hello" },
  ];
  const result = sanitizeMessages(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].content, "Hello");
});

test("sanitizeMessages preserves message structure", () => {
  const messages = [
    { role: "system", content: "System message" },
    { role: "user", content: "User message" },
    { role: "assistant", content: "Assistant message" },
  ];
  const result = sanitizeMessages(messages);
  assert.equal(result.length, 3);
  assert.equal(result[0].role, "system");
  assert.equal(result[1].role, "user");
  assert.equal(result[2].role, "assistant");
});

test("sanitizeMessages handles DeepSeek 400 error scenario", () => {
  // This is the exact scenario that caused the "text content is empty" error
  const messages = [
    {
      role: "system",
      content: [
        "You are a DeepSeek read-only worker inside OMK.",
        "Kimi is the main orchestrator and final reviewer.",
        "",
        "Return concise findings.",
      ].filter(Boolean).join(" "),
    },
    { role: "user", content: "" },
  ];
  const result = sanitizeMessages(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "system");
  assert.ok(result[0].content.includes("You are a DeepSeek read-only worker"));
});

test("sanitizeMessages handles content array with empty text parts", () => {
  // This simulates the edge case where content is an array with empty text
  const messages = [
    {
      role: "system",
      content: [
        { type: "text", text: "" },
        { type: "text", text: "Valid content" },
        { type: "text", text: "" },
      ],
    },
  ];
  const result = sanitizeMessages(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].content, "Valid content");
});
