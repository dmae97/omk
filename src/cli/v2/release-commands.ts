/**
 * Section 21 — CLI v2 Release Commands (Clipanion)
 *
 * `omk release check`  — Evaluate release promotion gate
 * `omk release promote` — Promote release if gate passes (stub)
 */

import { Command, Option, type Cli } from "clipanion";
import { createReleasePromotionGate } from "../release-promotion-gate.js";
import type { ReleasePromotionInputs } from "../../runtime/contracts/weakness-remediation.js";

type ClipanionRegistrar = Pick<Cli, "register">;

// ──────────────────────────────────────────────
// Release Check
// ──────────────────────────────────────────────

export class ReleaseCheckCommand extends Command {
  static override paths = [["release", "check"]];
  static override usage = Command.Usage({
    description: "Evaluate release promotion gate",
    examples: [["Check release readiness", "omk release check"]],
  });

  ci = Option.String("--ci", "1", { description: "CI score (0–1)" });
  schema = Option.String("--schema", "1", { description: "Schema score (0–1)" });
  docs = Option.String("--docs", "1", { description: "Docs score (0–1)" });
  proof = Option.String("--proof", "1", { description: "Proof median (0–1)" });
  provider = Option.String("--provider", "1", { description: "Provider minimum (0–1)" });
  regression = Option.String("--regression", "0", { description: "Regression severity (0–1)" });
  install = Option.String("--install", "1", { description: "Fresh install smoke (0–1)" });
  semver = Option.String("--semver", "1", { description: "Semver score (0–1)" });
  json = Option.Boolean("--json", false, { description: "JSON output" });

  async execute(): Promise<number> {
    const gate = createReleasePromotionGate();

    const inputs: ReleasePromotionInputs = {
      ci: Number.parseFloat(this.ci),
      schema: Number.parseFloat(this.schema),
      docs: Number.parseFloat(this.docs),
      proofMedian: Number.parseFloat(this.proof),
      providerMinimum: Number.parseFloat(this.provider),
      regressionSeverity: Number.parseFloat(this.regression),
      freshInstallSmoke: Number.parseFloat(this.install),
      semver: Number.parseFloat(this.semver),
    };

    const result = gate.evaluate(inputs);

    if (this.json) {
      this.context.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      this.context.stdout.write("Release Promotion Gate\n");
      this.context.stdout.write(`Score:   ${result.score.toFixed(4)}\n`);
      this.context.stdout.write(`Verdict: ${result.verdict}\n`);
      this.context.stdout.write(`Blocked: ${result.blocked}\n`);
      if (result.reasons.length > 0) {
        this.context.stdout.write("Reasons:\n");
        for (const reason of result.reasons) {
          this.context.stdout.write(`  - ${reason}\n`);
        }
      }
    }

    return result.verdict === "block" ? 1 : 0;
  }
}

// ──────────────────────────────────────────────
// Release Promote
// ──────────────────────────────────────────────

export class ReleasePromoteCommand extends Command {
  static override paths = [["release", "promote"]];
  static override usage = Command.Usage({
    description: "Promote release if gate passes",
    examples: [["Promote release", "omk release promote"]],
  });

  async execute(): Promise<number> {
    const gate = createReleasePromotionGate();

    const inputs: ReleasePromotionInputs = {
      ci: Number.parseFloat(process.env.OMK_RELEASE_CI ?? "1"),
      schema: Number.parseFloat(process.env.OMK_RELEASE_SCHEMA ?? "1"),
      docs: Number.parseFloat(process.env.OMK_RELEASE_DOCS ?? "1"),
      proofMedian: Number.parseFloat(process.env.OMK_RELEASE_PROOF ?? "1"),
      providerMinimum: Number.parseFloat(process.env.OMK_RELEASE_PROVIDER ?? "1"),
      regressionSeverity: Number.parseFloat(process.env.OMK_RELEASE_REGRESSION ?? "0"),
      freshInstallSmoke: Number.parseFloat(process.env.OMK_RELEASE_INSTALL ?? "1"),
      semver: Number.parseFloat(process.env.OMK_RELEASE_SEMVER ?? "1"),
    };

    const result = gate.evaluate(inputs);

    this.context.stdout.write(JSON.stringify(result, null, 2) + "\n");

    if (result.verdict === "block") {
      this.context.stderr.write("Release promotion blocked.\n");
      return 1;
    }

    this.context.stdout.write("Release promotion approved.\n");
    return 0;
  }
}

// ──────────────────────────────────────────────
// Registration
// ──────────────────────────────────────────────

export function registerReleaseCommandsV2(cli: ClipanionRegistrar): void {
  cli.register(ReleaseCheckCommand);
  cli.register(ReleasePromoteCommand);
}
