import { describe, expect, it } from "vitest";
import { normalizeToolNames, toolNameSetsEqual } from "../src/core/session-tool-selection";

describe("normalizeToolNames", () => {
  it("sorts names in code-unit order", () => {
    expect(normalizeToolNames(["read", "bash", "edit"])).toEqual(["bash", "edit", "read"]);
  });

  it("trims whitespace and removes duplicates", () => {
    expect(normalizeToolNames([" read ", "read", "bash"])).toEqual(["bash", "read"]);
  });

  it("drops empty and whitespace-only names", () => {
    expect(normalizeToolNames(["", " ", "read"])).toEqual(["read"]);
  });

  it("returns an empty array for empty input", () => {
    expect(normalizeToolNames([])).toEqual([]);
  });

  it("sorts by code unit, not locale", () => {
    expect(normalizeToolNames(["b", "B", "a", "_x"])).toEqual(["B", "_x", "a", "b"]);
  });

  it("does not mutate the input array", () => {
    const input = ["b", "a"];
    normalizeToolNames(input);
    expect(input).toEqual(["b", "a"]);
  });
});

describe("toolNameSetsEqual", () => {
  it("returns true for the same names in a different order", () => {
    expect(toolNameSetsEqual(["read", "bash"], ["bash", "read"])).toBe(true);
  });

  it("returns true when duplicates and whitespace are normalized away", () => {
    expect(toolNameSetsEqual(["read"], ["read", "read", " read "])).toBe(true);
  });

  it("returns true when both sides normalize to empty", () => {
    expect(toolNameSetsEqual([], ["", " "])).toBe(true);
  });

  it("returns false when names differ only by case", () => {
    expect(toolNameSetsEqual(["read"], ["Read"])).toBe(false);
  });

  it("returns false when one side has an extra name", () => {
    expect(toolNameSetsEqual(["read", "bash"], ["read"])).toBe(false);
  });

  it("returns false when a name differs", () => {
    expect(toolNameSetsEqual(["a", "b"], ["a", "c"])).toBe(false);
  });
});
