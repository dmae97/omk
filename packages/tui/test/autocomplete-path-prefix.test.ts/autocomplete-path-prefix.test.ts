import assert from "node:assert";
import { describe, it } from "node:test";
import {
  buildCompletionValue,
  extractQuotedPrefix,
  findLastDelimiter,
  parsePathPrefix,
} from "../src/autocomplete-path-prefix.ts";

describe("findLastDelimiter", () => {
  it("returns the index of the last space", () => {
    assert.strictEqual(findLastDelimiter("foo bar"), 3);
  });

  it("returns the index of the last equals sign", () => {
    assert.strictEqual(findLastDelimiter("a=b"), 1);
  });

  it("returns the index of the last tab", () => {
    assert.strictEqual(findLastDelimiter("x\ty"), 1);
  });

  it("returns -1 when there is no delimiter", () => {
    assert.strictEqual(findLastDelimiter("src/a"), -1);
  });

  it("returns -1 for an empty string", () => {
    assert.strictEqual(findLastDelimiter(""), -1);
  });
});

describe("extractQuotedPrefix", () => {
  it("returns the unclosed quoted prefix", () => {
    assert.strictEqual(extractQuotedPrefix('open "my fi'), '"my fi');
  });

  it("keeps a leading @ with the quoted prefix", () => {
    assert.strictEqual(extractQuotedPrefix('see @"my fi'), '@"my fi');
  });

  it("returns the quoted prefix after an equals sign", () => {
    assert.strictEqual(extractQuotedPrefix('k="v w'), '"v w');
  });

  it("only the last, unclosed quote counts", () => {
    assert.strictEqual(extractQuotedPrefix('say "a" "b'), '"b');
  });

  it("returns null when the quotes are balanced", () => {
    assert.strictEqual(extractQuotedPrefix('"done" next'), null);
    assert.strictEqual(extractQuotedPrefix("plain"), null);
  });

  it("returns null when the quote is not at a token start", () => {
    assert.strictEqual(extractQuotedPrefix('x@"a b'), null);
    assert.strictEqual(extractQuotedPrefix('a"b c'), null);
  });
});

describe("parsePathPrefix", () => {
  it("parses a quoted @ prefix", () => {
    assert.deepStrictEqual(parsePathPrefix('@"my dir/'), {
      rawPrefix: "my dir/",
      isAtPrefix: true,
      isQuotedPrefix: true,
    });
  });

  it("parses a quoted prefix without @", () => {
    assert.deepStrictEqual(parsePathPrefix('"my dir/'), {
      rawPrefix: "my dir/",
      isAtPrefix: false,
      isQuotedPrefix: true,
    });
  });

  it("parses an @ prefix", () => {
    assert.deepStrictEqual(parsePathPrefix("@src/"), {
      rawPrefix: "src/",
      isAtPrefix: true,
      isQuotedPrefix: false,
    });
  });

  it("parses a bare @", () => {
    assert.deepStrictEqual(parsePathPrefix("@"), {
      rawPrefix: "",
      isAtPrefix: true,
      isQuotedPrefix: false,
    });
  });

  it("returns a plain prefix unchanged", () => {
    assert.deepStrictEqual(parsePathPrefix("src/"), {
      rawPrefix: "src/",
      isAtPrefix: false,
      isQuotedPrefix: false,
    });
  });
});

describe("buildCompletionValue", () => {
  it("prefixes a file with @", () => {
    assert.strictEqual(
      buildCompletionValue("src/a.ts", {
        isDirectory: false,
        isAtPrefix: true,
        isQuotedPrefix: false,
      }),
      "@src/a.ts",
    );
  });

  it("quotes a directory with a space", () => {
    assert.strictEqual(
      buildCompletionValue("my dir/", {
        isDirectory: true,
        isAtPrefix: false,
        isQuotedPrefix: false,
      }),
      '"my dir/"',
    );
  });

  it("quotes a directory with a space after @", () => {
    assert.strictEqual(
      buildCompletionValue("my dir/", {
        isDirectory: true,
        isAtPrefix: true,
        isQuotedPrefix: false,
      }),
      '@"my dir/"',
    );
  });

  it("keeps quotes for an already-quoted directory", () => {
    assert.strictEqual(
      buildCompletionValue("src/", {
        isDirectory: true,
        isAtPrefix: false,
        isQuotedPrefix: true,
      }),
      '"src/"',
    );
  });
});
