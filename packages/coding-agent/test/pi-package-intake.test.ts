import { describe, expect, it } from "vitest";
import {
	ALL_PI_PACKAGE_PORT_CANDIDATES,
	evaluatePiPackageIntake,
	P0_PI_PACKAGE_PORT_CANDIDATES,
	P1_PI_PACKAGE_PORT_CANDIDATES,
	type PiPackageCandidateReviewInput,
} from "../src/core/pi-package-intake.ts";

describe("pi package intake", () => {
	it("keeps clean P0+P1 ports out of direct permanent Pi adoption", () => {
		const report = evaluatePiPackageIntake();

		expect(report.summary.total).toBe(ALL_PI_PACKAGE_PORT_CANDIDATES.length);
		expect(ALL_PI_PACKAGE_PORT_CANDIDATES.length).toBe(
			P0_PI_PACKAGE_PORT_CANDIDATES.length + P1_PI_PACKAGE_PORT_CANDIDATES.length,
		);
		expect(report.summary.acceptedNative).toBeGreaterThan(0);
		expect(report.summary.acceptedReference).toBeGreaterThan(0);
		expect(report.summary.acceptedMeasurement).toBeGreaterThan(0);
		expect(report.summary.hardForkBlocked).toBe(0);
		expect(report.summary.reject).toBe(0);
		expect(report.results.every((result) => result.directPermanentPiAdoption === false)).toBe(true);
		expect(report.results.every((result) => result.definition.candidate.intendedUse !== "permanent-adopt")).toBe(
			true,
		);
		expect(report.results.every((result) => result.review.adoption !== "permanent-package")).toBe(true);
	});

	it("marks legacy Pi source as hard-fork blocked through procurement compatibility gates", () => {
		const reviews: PiPackageCandidateReviewInput[] = [
			{
				candidateId: "pi-mcp-adapter",
				sources: [
					{
						path: "src/index.ts",
						text: [
							'import { start } from "@earendil-works/pi-mcp-adapter";',
							'const stateDir = ".pi/agents";',
							'const install = "pi install pi-mcp-adapter";',
						].join("\n"),
					},
				],
			},
		];

		const report = evaluatePiPackageIntake({ reviews });
		const blocked = report.results.find((result) => result.definition.id === "pi-mcp-adapter");

		expect(blocked).toBeDefined();
		expect(blocked?.hardForkBlocked).toBe(true);
		expect(blocked?.review.pathCompatibility).toBe("legacy-hardcoded");
		expect(blocked?.review.compatibilityFindings.map((finding) => finding.kind)).toEqual(
			expect.arrayContaining(["legacy-import", "legacy-state-dir", "legacy-project-path", "legacy-cli-invocation"]),
		);
		expect(report.summary.hardForkBlocked).toBe(1);
	});

	it("routes lifecycle scripts through existing procurement gates", () => {
		const reviews: PiPackageCandidateReviewInput[] = [
			{
				candidateId: "pi-lens",
				packageJsonScripts: { postinstall: "node ./scripts/install-pi.js" },
			},
		];

		const report = evaluatePiPackageIntake({ reviews });
		const blocked = report.results.find((result) => result.definition.id === "pi-lens");

		expect(blocked?.review.lifecycleVerdict).toBe("reject");
		expect(blocked?.review.declaredLifecycleScripts).toEqual(["postinstall"]);
		expect(blocked?.review.adoption).toBe("reject");
		expect(blocked?.hardForkBlocked).toBe(true);
	});

	it("summarizes all P0+P1 lanes for footer display", () => {
		const report = evaluatePiPackageIntake();
		const lanes = report.summary.topLanes.map((lane) => lane.lane);
		const labels = report.summary.topLanes.map((lane) => lane.label);

		expect(lanes).toEqual(
			expect.arrayContaining([
				"mcp",
				"lens",
				"browser",
				"subagent",
				"footer",
				"todo",
				"memory",
				"safety",
				"context-opt",
				"goal",
				"code-search",
				"observability",
				"actor",
				"interactive-ui",
				"side-channel",
				"review",
			]),
		);
		expect(labels).toContain("MCP");
		expect(report.summary.topLanes.every((lane) => lane.total > 0)).toBe(true);
	});

	it("P1 batch never claims native or permanent-adopt intent (unreviewed source)", () => {
		for (const candidate of P1_PI_PACKAGE_PORT_CANDIDATES) {
			expect(candidate.candidate.intendedUse).not.toBe("native");
			expect(candidate.candidate.intendedUse).not.toBe("permanent-adopt");
		}

		const report = evaluatePiPackageIntake({ candidates: P1_PI_PACKAGE_PORT_CANDIDATES });
		expect(report.summary.total).toBe(P1_PI_PACKAGE_PORT_CANDIDATES.length);
		expect(report.summary.hardForkBlocked).toBe(0);
		expect(report.summary.reject).toBe(0);
		expect(report.results.every((result) => result.directPermanentPiAdoption === false)).toBe(true);
	});

	it("routes the pi-simplify review candidate to report-only, not a mutating adoption", () => {
		const report = evaluatePiPackageIntake({ candidates: P1_PI_PACKAGE_PORT_CANDIDATES });
		const simplify = report.results.find((result) => result.definition.id === "pi-simplify");

		expect(simplify).toBeDefined();
		expect(simplify?.review.adoption).toBe("report-only");
	});

	it("routes the braintrust observability candidate through a strict export policy, never a default-on data path", () => {
		const report = evaluatePiPackageIntake({ candidates: P1_PI_PACKAGE_PORT_CANDIDATES });
		const braintrust = report.results.find((result) => result.definition.id === "braintrust-pi-extension");

		expect(braintrust).toBeDefined();
		expect(braintrust?.review.adoption).toBe("advisory-only");
	});
});
