import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ConsentFlowManager,
  ConsentDecision,
  ConsentScope,
  ConsentAwareResolver,
} from "../dist/mcp/consent-flow.js";
import { ToolPermissionLevel, PermissionMatcher, createRule, RuleSeverity } from "../dist/mcp/governance.js";

describe("ConsentFlowManager", () => {
  let manager;

  beforeEach(() => {
    manager = new ConsentFlowManager({ emitEvents: false });
  });

  describe("checkConsent", () => {
    it("returns null when permission is ALLOW", () => {
      const resolved = {
        permission: ToolPermissionLevel.ALLOW,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      const result = manager.checkConsent("read_file", "fs", {}, resolved);
      assert.equal(result, null);
    });

    it("returns null when permission is DENY", () => {
      const resolved = {
        permission: ToolPermissionLevel.DENY,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      const result = manager.checkConsent("rm_rf", "fs", {}, resolved);
      assert.equal(result, null);
    });

    it("returns ConsentRequest when permission is ASK", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: { pattern: "bash*", permission: ToolPermissionLevel.ASK, reason: "Shell needs consent" },
        serverLevel: false,
        governanceBypass: false,
      };
      const result = manager.checkConsent("bash_exec", "shell", { cmd: "ls" }, resolved);
      assert.notEqual(result, null);
      assert.equal(result.toolName, "bash_exec");
      assert.equal(result.serverName, "shell");
      assert.equal(result.args.cmd, "ls");
      assert.equal(result.reason, "Shell needs consent");
    });

    it("returns null when stored decision exists for ALLOW_ALWAYS", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: { pattern: "bash*", permission: ToolPermissionLevel.ASK },
        serverLevel: false,
        governanceBypass: false,
      };

      // First call — creates request
      const req = manager.checkConsent("bash_exec", "shell", {}, resolved);
      assert.notEqual(req, null);

      // Record ALLOW_ALWAYS
      manager.recordDecision(req.id, ConsentDecision.ALLOW_ALWAYS);

      // Second call — should return null (stored decision)
      const result = manager.checkConsent("bash_exec", "shell", {}, resolved);
      assert.equal(result, null);
    });

    it("returns null when stored decision exists for DENY_ALWAYS", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: { pattern: "bash*", permission: ToolPermissionLevel.ASK },
        serverLevel: false,
        governanceBypass: false,
      };

      const req = manager.checkConsent("bash_exec", "shell", {}, resolved);
      manager.recordDecision(req.id, ConsentDecision.DENY_ALWAYS);

      const result = manager.checkConsent("bash_exec", "shell", {}, resolved);
      assert.equal(result, null);
    });

    it("does not cache ALLOW_ONCE decisions", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: { pattern: "bash*", permission: ToolPermissionLevel.ASK },
        serverLevel: false,
        governanceBypass: false,
      };

      const req = manager.checkConsent("bash_exec", "shell", {}, resolved);
      manager.recordDecision(req.id, ConsentDecision.ALLOW_ONCE);

      // Should still need consent next time
      const result = manager.checkConsent("bash_exec", "shell", {}, resolved);
      assert.notEqual(result, null);
    });
  });

  describe("recordDecision", () => {
    it("stores ALLOW_ALWAYS decisions", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: { pattern: "bash*", permission: ToolPermissionLevel.ASK },
        serverLevel: false,
        governanceBypass: false,
      };

      const req = manager.checkConsent("bash_exec", "shell", {}, resolved);
      const result = manager.recordDecision(req.id, ConsentDecision.ALLOW_ALWAYS);

      assert.equal(result.decision, ConsentDecision.ALLOW_ALWAYS);
      assert.equal(result.scope, ConsentScope.SESSION);

      const stored = manager.getStoredDecisions();
      assert.equal(stored.length, 1);
      assert.equal(stored[0].toolPattern, "bash_exec");
      assert.equal(stored[0].permission, ToolPermissionLevel.ALLOW);
    });

    it("stores DENY_ALWAYS decisions", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: { pattern: "git_push*", permission: ToolPermissionLevel.ASK },
        serverLevel: false,
        governanceBypass: false,
      };

      const req = manager.checkConsent("git_push", "git", {}, resolved);
      const result = manager.recordDecision(req.id, ConsentDecision.DENY_ALWAYS);

      assert.equal(result.decision, ConsentDecision.DENY_ALWAYS);

      const stored = manager.getStoredDecisions();
      assert.equal(stored.length, 1);
      assert.equal(stored[0].permission, ToolPermissionLevel.DENY);
    });

    it("does not store ALLOW_ONCE decisions", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };

      const req = manager.checkConsent("test_tool", "test", {}, resolved);
      manager.recordDecision(req.id, ConsentDecision.ALLOW_ONCE);

      assert.equal(manager.getStoredDecisions().length, 0);
    });

    it("throws for invalid request id", () => {
      assert.throws(
        () => manager.recordDecision("nonexistent", ConsentDecision.ALLOW_ONCE),
        /No pending consent request/,
      );
    });

    it("respects custom scope", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };

      const req = manager.checkConsent("test_tool", "test", {}, resolved);
      const result = manager.recordDecision(req.id, ConsentDecision.ALLOW_ALWAYS, ConsentScope.PERMANENT);

      assert.equal(result.scope, ConsentScope.PERMANENT);
      assert.equal(manager.getStoredDecisions()[0].scope, ConsentScope.PERMANENT);
    });
  });

  describe("resolveConsent", () => {
    it("returns null when no stored decision", () => {
      assert.equal(manager.resolveConsent("bash_exec", "shell"), null);
    });

    it("returns ALLOW when stored", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      const req = manager.checkConsent("bash_exec", "shell", {}, resolved);
      manager.recordDecision(req.id, ConsentDecision.ALLOW_ALWAYS);

      assert.equal(manager.resolveConsent("bash_exec", "shell"), ToolPermissionLevel.ALLOW);
    });

    it("matches wildcard server", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      // Store with specific server
      const req = manager.checkConsent("bash_exec", "shell", {}, resolved);
      manager.recordDecision(req.id, ConsentDecision.ALLOW_ALWAYS);

      // Same tool, different server — should NOT match (server-specific)
      assert.equal(manager.resolveConsent("bash_exec", "other"), null);
    });
  });

  describe("decision management", () => {
    it("removes decisions", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      const req = manager.checkConsent("bash_exec", "shell", {}, resolved);
      manager.recordDecision(req.id, ConsentDecision.ALLOW_ALWAYS);

      assert.equal(manager.getStoredDecisions().length, 1);
      assert.equal(manager.removeDecision("bash_exec", "shell"), true);
      assert.equal(manager.getStoredDecisions().length, 0);
    });

    it("clears all decisions", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      const req1 = manager.checkConsent("tool1", "srv1", {}, resolved);
      manager.recordDecision(req1.id, ConsentDecision.ALLOW_ALWAYS);
      const req2 = manager.checkConsent("tool2", "srv2", {}, resolved);
      manager.recordDecision(req2.id, ConsentDecision.DENY_ALWAYS);

      assert.equal(manager.getStoredDecisions().length, 2);
      manager.clearDecisions();
      assert.equal(manager.getStoredDecisions().length, 0);
    });

    it("gets pending requests", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      manager.checkConsent("tool1", "srv1", {}, resolved);
      manager.checkConsent("tool2", "srv2", {}, resolved);

      assert.equal(manager.getPendingRequests().length, 2);
    });

    it("cancels pending requests", () => {
      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      const req = manager.checkConsent("tool1", "srv1", {}, resolved);
      assert.equal(manager.getPendingRequests().length, 1);

      assert.equal(manager.cancelRequest(req.id), true);
      assert.equal(manager.getPendingRequests().length, 0);
    });
  });

  describe("formatRequest", () => {
    it("formats consent request with all fields", () => {
      const request = {
        id: "test-id",
        timestamp: "2026-05-12T00:00:00Z",
        toolName: "bash_exec",
        serverName: "shell",
        args: { cmd: "ls -la" },
        permission: {
          permission: ToolPermissionLevel.ASK,
          matchedRule: null,
          serverLevel: false,
          governanceBypass: false,
        },
        reason: "Shell commands need consent",
        severity: "high",
        category: "shell",
      };

      const formatted = ConsentFlowManager.formatRequest(request);
      assert.ok(formatted.includes("bash_exec"));
      assert.ok(formatted.includes("shell"));
      assert.ok(formatted.includes("Shell commands need consent"));
      assert.ok(formatted.includes("HIGH"));
      assert.ok(formatted.includes("[y]"));
      assert.ok(formatted.includes("[n]"));
      assert.ok(formatted.includes("[Y]"));
      assert.ok(formatted.includes("[N]"));
    });
  });

  describe("formatResult", () => {
    it("formats allow-once result", () => {
      const result = {
        decision: ConsentDecision.ALLOW_ONCE,
        request: { toolName: "bash_exec" },
        decidedAt: "2026-05-12T00:00:00Z",
        scope: ConsentScope.SESSION,
      };
      const formatted = ConsentFlowManager.formatResult(result);
      assert.ok(formatted.includes("✓"));
      assert.ok(formatted.includes("Allowed once"));
    });

    it("formats deny-always result", () => {
      const result = {
        decision: ConsentDecision.DENY_ALWAYS,
        request: { toolName: "bash_exec" },
        decidedAt: "2026-05-12T00:00:00Z",
        scope: ConsentScope.SESSION,
      };
      const formatted = ConsentFlowManager.formatResult(result);
      assert.ok(formatted.includes("✗"));
      assert.ok(formatted.includes("Denied always"));
    });
  });

  describe("events", () => {
    it("emits consent:required on checkConsent", () => {
      const eventManager = new ConsentFlowManager({ emitEvents: true });
      let emitted = false;
      eventManager.on("consent:required", () => { emitted = true; });

      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      eventManager.checkConsent("tool", "srv", {}, resolved);
      assert.equal(emitted, true);
    });

    it("emits consent:decided on recordDecision", () => {
      const eventManager = new ConsentFlowManager({ emitEvents: true });
      let emitted = false;
      eventManager.on("consent:decided", () => { emitted = true; });

      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      const req = eventManager.checkConsent("tool", "srv", {}, resolved);
      eventManager.recordDecision(req.id, ConsentDecision.ALLOW_ONCE);
      assert.equal(emitted, true);
    });

    it("emits consent:cancelled on cancelRequest", () => {
      const eventManager = new ConsentFlowManager({ emitEvents: true });
      let emitted = false;
      eventManager.on("consent:cancelled", () => { emitted = true; });

      const resolved = {
        permission: ToolPermissionLevel.ASK,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: false,
      };
      const req = eventManager.checkConsent("tool", "srv", {}, resolved);
      eventManager.cancelRequest(req.id);
      assert.equal(emitted, true);
    });
  });
});

describe("ConsentAwareResolver", () => {
  it("returns ALLOW directly when permission is ALLOW", () => {
    const resolver = new ConsentAwareResolver();
    const resolved = {
      permission: ToolPermissionLevel.ALLOW,
      matchedRule: null,
      serverLevel: false,
      governanceBypass: false,
    };
    const result = resolver.resolveWithConsent("read_file", "fs", {}, resolved);
    assert.equal(result.permission, ToolPermissionLevel.ALLOW);
    assert.equal(result.consentRequest, undefined);
  });

  it("returns DENY directly when permission is DENY", () => {
    const resolver = new ConsentAwareResolver();
    const resolved = {
      permission: ToolPermissionLevel.DENY,
      matchedRule: null,
      serverLevel: false,
      governanceBypass: false,
    };
    const result = resolver.resolveWithConsent("rm_rf", "fs", {}, resolved);
    assert.equal(result.permission, ToolPermissionLevel.DENY);
    assert.equal(result.consentRequest, undefined);
  });

  it("returns consent request when permission is ASK", () => {
    const resolver = new ConsentAwareResolver();
    const resolved = {
      permission: ToolPermissionLevel.ASK,
      matchedRule: { pattern: "bash*", permission: ToolPermissionLevel.ASK },
      serverLevel: false,
      governanceBypass: false,
    };
    const result = resolver.resolveWithConsent("bash_exec", "shell", {}, resolved);
    assert.equal(result.permission, ToolPermissionLevel.DENY); // Default pending consent
    assert.notEqual(result.consentRequest, undefined);
    assert.equal(result.consentRequest.toolName, "bash_exec");
  });

  it("uses stored consent when available", () => {
    const resolver = new ConsentAwareResolver();
    const manager = resolver.getConsentManager();
    const resolved = {
      permission: ToolPermissionLevel.ASK,
      matchedRule: null,
      serverLevel: false,
      governanceBypass: false,
    };

    // First call — creates request
    const first = resolver.resolveWithConsent("bash_exec", "shell", {}, resolved);
    assert.notEqual(first.consentRequest, undefined);

    // Record ALLOW_ALWAYS
    manager.recordDecision(first.consentRequest.id, ConsentDecision.ALLOW_ALWAYS);

    // Second call — uses stored decision
    const second = resolver.resolveWithConsent("bash_exec", "shell", {}, resolved);
    assert.equal(second.permission, ToolPermissionLevel.ALLOW);
    assert.equal(second.consentRequest, undefined);
  });
});
