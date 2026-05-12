// ─── P2.4 Governance Rules Tests ──────────────────────────────────────────────
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RuleSeverity,
  createRule,
  STRICT_PRESET,
  PERMISSIVE_PRESET,
  DEVELOPMENT_PRESET,
  GOVERNANCE_PRESETS,
  getPreset,
  listPresets,
} from "../dist/mcp/governance.js";

describe("P2.4 Governance Rules", () => {
  describe("RuleSeverity enum", () => {
    it("should have all severity levels", () => {
      assert.equal(RuleSeverity.CRITICAL, "critical");
      assert.equal(RuleSeverity.HIGH, "high");
      assert.equal(RuleSeverity.MEDIUM, "medium");
      assert.equal(RuleSeverity.LOW, "low");
      assert.equal(RuleSeverity.INFO, "info");
    });
  });

  describe("createRule()", () => {
    it("should create a rule with defaults", () => {
      const rule = createRule("test_*", "allow");
      assert.equal(rule.pattern, "test_*");
      assert.equal(rule.permission, "allow");
      assert.equal(rule.severity, RuleSeverity.MEDIUM);
      assert.equal(rule.enabled, true);
      assert.ok(rule.createdAt);
    });

    it("should create a rule with custom options", () => {
      const rule = createRule("github_*", "ask", {
        severity: RuleSeverity.HIGH,
        reason: "GitHub write ops need consent",
        priority: 10,
        serverName: "github",
        category: "github",
      });
      assert.equal(rule.severity, RuleSeverity.HIGH);
      assert.equal(rule.reason, "GitHub write ops need consent");
      assert.equal(rule.priority, 10);
      assert.equal(rule.serverName, "github");
      assert.equal(rule.category, "github");
    });
  });

  describe("Governance Presets", () => {
    it("should have 3 presets", () => {
      assert.equal(Object.keys(GOVERNANCE_PRESETS).length, 3);
      assert.ok(GOVERNANCE_PRESETS.strict);
      assert.ok(GOVERNANCE_PRESETS.permissive);
      assert.ok(GOVERNANCE_PRESETS.development);
    });

    it("listPresets() should return preset names", () => {
      const names = listPresets();
      assert.deepEqual(names.sort(), ["development", "permissive", "strict"]);
    });

    it("getPreset() should return preset by name", () => {
      assert.equal(getPreset("strict"), STRICT_PRESET);
      assert.equal(getPreset("permissive"), PERMISSIVE_PRESET);
      assert.equal(getPreset("development"), DEVELOPMENT_PRESET);
      assert.equal(getPreset("nonexistent"), undefined);
    });
  });

  describe("STRICT_PRESET", () => {
    it("should have name and description", () => {
      assert.equal(STRICT_PRESET.name, "strict");
      assert.ok(STRICT_PRESET.description.length > 0);
    });

    it("default permission should be ASK", () => {
      assert.equal(STRICT_PRESET.defaultPermission, "ask");
    });

    it("should have CRITICAL deny rules for destructive ops", () => {
      const criticalRules = STRICT_PRESET.rules.filter(
        (r) => r.severity === RuleSeverity.CRITICAL && r.permission === "deny",
      );
      assert.ok(criticalRules.length >= 4, `Expected >=4 critical deny rules, got ${criticalRules.length}`);
    });

    it("should allow read operations", () => {
      const readRules = STRICT_PRESET.rules.filter(
        (r) => r.pattern.startsWith("read") && r.permission === "allow",
      );
      assert.ok(readRules.length > 0);
    });

    it("should ask for write operations", () => {
      const writeRules = STRICT_PRESET.rules.filter(
        (r) => r.pattern.startsWith("write") && r.permission === "ask",
      );
      assert.ok(writeRules.length > 0);
    });

    it("should ask for git operations", () => {
      const gitRules = STRICT_PRESET.rules.filter(
        (r) => r.pattern.startsWith("git_") && r.permission === "ask",
      );
      assert.ok(gitRules.length > 0);
    });
  });

  describe("PERMISSIVE_PRESET", () => {
    it("default permission should be ALLOW", () => {
      assert.equal(PERMISSIVE_PRESET.defaultPermission, "allow");
    });

    it("should still deny critical destructive ops", () => {
      const criticalDeny = PERMISSIVE_PRESET.rules.filter(
        (r) => r.severity === RuleSeverity.CRITICAL && r.permission === "deny",
      );
      assert.ok(criticalDeny.length >= 4);
    });

    it("should allow most operations", () => {
      const allowRules = PERMISSIVE_PRESET.rules.filter((r) => r.permission === "allow");
      assert.ok(allowRules.length > 5, `Expected >5 allow rules, got ${allowRules.length}`);
    });

    it("should still ask for shell commands", () => {
      const shellRules = PERMISSIVE_PRESET.rules.filter(
        (r) => (r.pattern === "bash*" || r.pattern === "shell*") && r.permission === "ask",
      );
      assert.ok(shellRules.length > 0);
    });
  });

  describe("DEVELOPMENT_PRESET", () => {
    it("default permission should be ALLOW", () => {
      assert.equal(DEVELOPMENT_PRESET.defaultPermission, "allow");
    });

    it("should allow common dev tools (glob, grep, read, write, edit)", () => {
      const devTools = ["glob*", "grep*", "read*", "write*", "edit*"];
      for (const pattern of devTools) {
        const rule = DEVELOPMENT_PRESET.rules.find((r) => r.pattern === pattern);
        assert.ok(rule, `Missing rule for ${pattern}`);
        assert.equal(rule.permission, "allow", `${pattern} should be allowed`);
      }
    });

    it("should ask before push", () => {
      const pushRule = DEVELOPMENT_PRESET.rules.find((r) => r.pattern === "git_push*");
      assert.ok(pushRule);
      assert.equal(pushRule.permission, "ask");
    });

    it("should ask before PR merge", () => {
      const mergeRule = DEVELOPMENT_PRESET.rules.find(
        (r) => r.pattern === "github_merge_pull_request",
      );
      assert.ok(mergeRule);
      assert.equal(mergeRule.permission, "ask");
      assert.equal(mergeRule.severity, RuleSeverity.HIGH);
    });
  });

  describe("Server-specific rules", () => {
    it("createRule should support serverName", () => {
      const rule = createRule("create_issue", "ask", {
        serverName: "github",
        category: "github",
      });
      assert.equal(rule.serverName, "github");
      assert.equal(rule.category, "github");
    });
  });
});
