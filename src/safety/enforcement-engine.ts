/**
 * Policy / Sandbox Enforcement Engine v2
 *
 * Capability lattice with conservative policy combination.
 * effectivePolicy = minByAuthority(userPolicy, repoPolicy, providerPolicy, adapterPolicy, riskPolicy)
 *
 * Conservative by default. Any ambiguity → block.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Capability lattice
// ---------------------------------------------------------------------------

export type SandboxCapability =
  | "read"
  | "write"
  | "shell"
  | "network"
  | "secret_read"
  | "secret_write"
  | "merge"
  | "publish";

export const ALL_CAPABILITIES: readonly SandboxCapability[] = [
  "read",
  "write",
  "shell",
  "network",
  "secret_read",
  "secret_write",
  "merge",
  "publish",
];

export type CapabilityLevel = "none" | "advisory" | "direct" | "full";

export interface CapabilityLattice {
  read: CapabilityLevel;
  write: CapabilityLevel;
  shell: CapabilityLevel;
  network: CapabilityLevel;
  secret_read: CapabilityLevel;
  secret_write: CapabilityLevel;
  merge: CapabilityLevel;
  publish: CapabilityLevel;
}

export type SandboxMode = "read-only" | "workspace-write" | "network-isolated" | "unrestricted";

export type ApprovalPolicy = "interactive" | "auto" | "yolo" | "block";

// ---------------------------------------------------------------------------
// Policy layer (one contributing policy)
// ---------------------------------------------------------------------------

export interface PolicyLayer {
  readonly source:
    | "user"
    | "repo"
    | "provider"
    | "adapter"
    | "risk";
  /** Partial lattice — omitted capabilities mean "no opinion" (inherit from other layers). */
  readonly lattice: Partial<CapabilityLattice>;
  readonly sandboxMode?: SandboxMode;
  readonly approvalPolicy?: ApprovalPolicy;
}

// ---------------------------------------------------------------------------
// Combined policy result
// ---------------------------------------------------------------------------

export interface CombinedPolicy {
  readonly lattice: Readonly<CapabilityLattice>;
  readonly sandboxMode: SandboxMode;
  readonly approvalPolicy: ApprovalPolicy;
  /** Ordered list of sources that contributed to the combination. */
  readonly sources: readonly PolicyLayer["source"][];
}

// ---------------------------------------------------------------------------
// Enforcement proof returned by adapter / runtime
// ---------------------------------------------------------------------------

export interface EnforcementProof {
  readonly sandboxMode: SandboxMode;
  /** Which policy layers were active in the final combination. */
  readonly enforcedBy: readonly string[];
  /** Capabilities fully blocked (level === "none" or sandbox hard floor). */
  readonly blockedCapabilities: readonly SandboxCapability[];
  /** Capabilities that require explicit approval (level === "advisory" or interactive policy). */
  readonly approvalRequired: readonly SandboxCapability[];
  /** Deterministic hash of the combined policy for audit / replay. */
  readonly policyHash: string;
}

// ---------------------------------------------------------------------------
// Authority ranking (higher = more permissive)
// ---------------------------------------------------------------------------

const AUTHORITY_RANK: Record<CapabilityLevel, number> = {
  none: 0,
  advisory: 1,
  direct: 2,
  full: 3,
};

export function rankOf(level: CapabilityLevel): number {
  return AUTHORITY_RANK[level];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CAPABILITY_LEVEL: CapabilityLevel = "full";

const DEFAULT_SANDBOX_MODE: SandboxMode = "unrestricted";

const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = "yolo";

export function defaultLattice(): CapabilityLattice {
  return {
    read: DEFAULT_CAPABILITY_LEVEL,
    write: DEFAULT_CAPABILITY_LEVEL,
    shell: DEFAULT_CAPABILITY_LEVEL,
    network: DEFAULT_CAPABILITY_LEVEL,
    secret_read: DEFAULT_CAPABILITY_LEVEL,
    secret_write: DEFAULT_CAPABILITY_LEVEL,
    merge: DEFAULT_CAPABILITY_LEVEL,
    publish: DEFAULT_CAPABILITY_LEVEL,
  };
}

// ---------------------------------------------------------------------------
// minByAuthority — conservative combination
// ---------------------------------------------------------------------------

/**
 * Combine multiple policy layers by taking the **most restrictive**
 * (minimum) authority level for each capability.
 *
 * If no layer expresses an opinion on a capability, it defaults to "full".
 * If any layer expresses a sandbox mode, the most restrictive mode wins.
 * If any layer expresses an approval policy, the most restrictive wins.
 */
export function combinePoliciesByMinAuthority(
  layers: readonly PolicyLayer[],
): CombinedPolicy {
  const base = defaultLattice();
  const activeSources: PolicyLayer["source"][] = [];

  // Track the most restrictive values seen so far.
  const lattice: Record<SandboxCapability, CapabilityLevel> = { ...base };
  let sandboxMode: SandboxMode = DEFAULT_SANDBOX_MODE;
  let approvalPolicy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY;

  for (const layer of layers) {
    activeSources.push(layer.source);

    for (const cap of ALL_CAPABILITIES) {
      const level = layer.lattice[cap];
      if (level !== undefined) {
        if (AUTHORITY_RANK[level] < AUTHORITY_RANK[lattice[cap]]) {
          lattice[cap] = level;
        }
      }
    }

    if (layer.sandboxMode !== undefined) {
      if (sandboxModeRank(layer.sandboxMode) < sandboxModeRank(sandboxMode)) {
        sandboxMode = layer.sandboxMode;
      }
    }

    if (layer.approvalPolicy !== undefined) {
      if (approvalPolicyRank(layer.approvalPolicy) < approvalPolicyRank(approvalPolicy)) {
        approvalPolicy = layer.approvalPolicy;
      }
    }
  }

  return {
    lattice: lattice as CapabilityLattice,
    sandboxMode,
    approvalPolicy,
    sources: activeSources,
  };
}

// ---------------------------------------------------------------------------
// Ranking helpers for sandbox mode and approval policy
// ---------------------------------------------------------------------------

function sandboxModeRank(mode: SandboxMode): number {
  switch (mode) {
    case "read-only":
      return 0;
    case "network-isolated":
      return 1;
    case "workspace-write":
      return 2;
    case "unrestricted":
      return 3;
  }
}

function approvalPolicyRank(policy: ApprovalPolicy): number {
  switch (policy) {
    case "block":
      return 0;
    case "interactive":
      return 1;
    case "auto":
      return 2;
    case "yolo":
      return 3;
  }
}

// ---------------------------------------------------------------------------
// Derive blocked / approval-required capabilities from combined policy
// ---------------------------------------------------------------------------

/**
 * Compute the enforcement proof from a combined policy.
 *
 * Rules:
 * 1. read-only sandbox blocks write, shell, network, merge, publish.
 * 2. network-isolated sandbox blocks network.
 * 3. Any capability with level "none" is blocked.
 * 4. Any capability with level "advisory" requires approval.
 * 5. interactive policy requires approval for non-read capabilities.
 * 6. block policy blocks everything except read.
 */
export function computeEnforcementProof(
  combined: CombinedPolicy,
): EnforcementProof {
  const blocked = new Set<SandboxCapability>();
  const approvalRequired = new Set<SandboxCapability>();

  const { lattice, sandboxMode, approvalPolicy, sources } = combined;

  // Sandbox hard floors
  if (sandboxMode === "read-only") {
    for (const cap of ["write", "shell", "network", "merge", "publish", "secret_write"] as SandboxCapability[]) {
      blocked.add(cap);
    }
  }
  if (sandboxMode === "network-isolated") {
    blocked.add("network");
  }

  // Per-capability levels
  for (const cap of ALL_CAPABILITIES) {
    const level = lattice[cap];
    if (level === "none") {
      blocked.add(cap);
    } else if (level === "advisory") {
      approvalRequired.add(cap);
    }
  }

  // Approval policy overrides
  if (approvalPolicy === "block") {
    for (const cap of ALL_CAPABILITIES) {
      if (cap !== "read") blocked.add(cap);
    }
  } else if (approvalPolicy === "interactive") {
    for (const cap of ALL_CAPABILITIES) {
      if (cap !== "read" && !blocked.has(cap)) {
        approvalRequired.add(cap);
      }
    }
  } else if (approvalPolicy === "yolo") {
    // yolo removes approval requirements (but keeps blocks)
    for (const cap of ALL_CAPABILITIES) {
      approvalRequired.delete(cap);
    }
  }

  // auto: advisory-level capabilities still need approval; full = allow
  // (approvalRequired already contains advisory-level caps)

  const blockedCapabilities = ALL_CAPABILITIES.filter((c) => blocked.has(c));
  const approvalRequiredCapabilities = ALL_CAPABILITIES.filter(
    (c) => approvalRequired.has(c) && !blocked.has(c),
  );

  return {
    sandboxMode,
    enforcedBy: [...sources],
    blockedCapabilities,
    approvalRequired: approvalRequiredCapabilities,
    policyHash: hashCombinedPolicy(combined),
  };
}

// ---------------------------------------------------------------------------
// Policy hash (deterministic, no secrets)
// ---------------------------------------------------------------------------

function hashCombinedPolicy(combined: CombinedPolicy): string {
  const payload = JSON.stringify({
    lattice: combined.lattice,
    sandboxMode: combined.sandboxMode,
    approvalPolicy: combined.approvalPolicy,
    sources: combined.sources,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Adapter enforcement check
// ---------------------------------------------------------------------------

/**
 * Returns true when the runtime/adapter has provided a valid enforcement proof.
 * Runtimes without enforcement proof cannot enter authority lanes.
 */
export function hasValidEnforcementProof(proof: unknown): proof is EnforcementProof {
  if (typeof proof !== "object" || proof === null) return false;
  const p = proof as Record<string, unknown>;
  if (typeof p.policyHash !== "string" || p.policyHash.length === 0) return false;
  if (!Array.isArray(p.enforcedBy) || p.enforcedBy.length === 0) return false;
  if (!Array.isArray(p.blockedCapabilities)) return false;
  if (!Array.isArray(p.approvalRequired)) return false;
  if (!isSandboxMode(p.sandboxMode)) return false;
  return true;
}

function isSandboxMode(v: unknown): v is SandboxMode {
  return v === "read-only" || v === "workspace-write" || v === "network-isolated" || v === "unrestricted";
}

// ---------------------------------------------------------------------------
// Convenience: build a PolicyLayer from legacy authority levels
// ---------------------------------------------------------------------------

export function policyLayerFromLegacyAuthorities(
  source: PolicyLayer["source"],
  options: {
    writeAuthority?: "none" | "advisory" | "direct" | "full";
    shellAuthority?: "none" | "advisory" | "direct" | "full";
    sandboxMode?: SandboxMode;
    approvalPolicy?: ApprovalPolicy;
  },
): PolicyLayer {
  const lattice: Partial<CapabilityLattice> = {};
  if (options.writeAuthority) {
    lattice.write = options.writeAuthority;
    lattice.merge = options.writeAuthority;
    lattice.publish = options.writeAuthority;
  }
  if (options.shellAuthority) {
    lattice.shell = options.shellAuthority;
    lattice.merge = minLevel(lattice.merge, options.shellAuthority);
    lattice.publish = minLevel(lattice.publish, options.shellAuthority);
  }
  return {
    source,
    lattice,
    sandboxMode: options.sandboxMode,
    approvalPolicy: options.approvalPolicy,
  };
}

function minLevel(a: CapabilityLevel | undefined, b: CapabilityLevel): CapabilityLevel {
  if (a === undefined) return b;
  return AUTHORITY_RANK[a] <= AUTHORITY_RANK[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Capability-to-ToolOp mapping for the authority gate
// ---------------------------------------------------------------------------

export type ToolOpV2 = "read" | "write" | "shell" | "merge" | "network" | "secret";

/**
 * Map a capability-lattice capability to the coarse ToolOp used by the gate.
 * This preserves backward compatibility with the existing 4-class gate while
 * allowing the new lattice to express finer-grained restrictions.
 */
export function capabilityToToolOp(cap: SandboxCapability): ToolOpV2 {
  switch (cap) {
    case "read":
      return "read";
    case "write":
    case "publish":
      return "write";
    case "shell":
      return "shell";
    case "merge":
      return "merge";
    case "network":
      return "network";
    case "secret_read":
    case "secret_write":
      return "secret";
  }
}
