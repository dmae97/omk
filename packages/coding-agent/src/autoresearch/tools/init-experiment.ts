import * as fs from "node:fs";
import * as path from "node:path";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../../extensibility/extensions";
import type { Theme } from "../../modes/theme/theme";
import { readMaxExperiments, resolveWorkDir, validateWorkDir } from "../helpers";
import { cloneExperimentState } from "../state";
import type { AutoresearchToolFactoryOptions, ExperimentState } from "../types";

const initExperimentSchema = Type.Object({
	name: Type.String({
		description: "Human-readable experiment name.",
	}),
	metric_name: Type.String({
		description: "Primary metric name shown in the dashboard.",
	}),
	metric_unit: Type.Optional(
		Type.String({
			description: "Unit for the primary metric, for example µs, ms, s, kb, or empty.",
		}),
	),
	direction: Type.Optional(
		StringEnum(["lower", "higher"], {
			description: "Whether lower or higher values are better. Defaults to lower.",
		}),
	),
});

interface InitExperimentDetails {
	state: ExperimentState;
}

export function createInitExperimentTool(
	options: AutoresearchToolFactoryOptions,
): ToolDefinition<typeof initExperimentSchema, InitExperimentDetails> {
	return {
		name: "init_experiment",
		label: "Init Experiment",
		description:
			"Initialize or reset the autoresearch session for the current optimization target before the first logged run of a segment.",
		parameters: initExperimentSchema,
		defaultInactive: true,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const workDirError = validateWorkDir(ctx.cwd);
			if (workDirError) {
				return {
					content: [{ type: "text", text: `Error: ${workDirError}` }],
				};
			}

			const runtime = options.getRuntime(ctx);
			const state = runtime.state;
			const isReinitializing = state.results.length > 0;

			state.name = params.name;
			state.metricName = params.metric_name;
			state.metricUnit = params.metric_unit ?? "";
			state.bestDirection = params.direction ?? "lower";
			state.maxExperiments = readMaxExperiments(ctx.cwd);
			state.bestMetric = null;
			state.confidence = null;
			state.secondaryMetrics = [];
			if (isReinitializing) {
				state.currentSegment += 1;
			}

			const workDir = resolveWorkDir(ctx.cwd);
			const jsonlPath = path.join(workDir, "autoresearch.jsonl");
			const configLine = JSON.stringify({
				type: "config",
				name: state.name,
				metricName: state.metricName,
				metricUnit: state.metricUnit,
				bestDirection: state.bestDirection,
			});

			if (isReinitializing) {
				fs.appendFileSync(jsonlPath, `${configLine}\n`);
			} else {
				fs.writeFileSync(jsonlPath, `${configLine}\n`);
			}

			runtime.autoresearchMode = true;
			options.dashboard.updateWidget(ctx, runtime);
			options.dashboard.requestRender();

			const lines = [
				`Experiment initialized: ${state.name}`,
				`Metric: ${state.metricName} (${state.metricUnit || "unitless"}, ${state.bestDirection} is better)`,
				`Working directory: ${workDir}`,
				isReinitializing
					? "Previous results remain in history. This starts a new segment and requires a fresh baseline."
					: "Now run the baseline experiment and log it.",
			];
			if (state.maxExperiments !== null) {
				lines.push(`Max iterations: ${state.maxExperiments}`);
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { state: cloneExperimentState(state) },
			};
		},
		renderCall(args, _options, theme): Text {
			return new Text(renderInitCall(args.name, theme), 0, 0);
		},
		renderResult(result): Text {
			const text = result.content.find(part => part.type === "text")?.text ?? "";
			return new Text(text, 0, 0);
		},
	};
}

function renderInitCall(name: string, theme: Theme): string {
	return `${theme.fg("toolTitle", theme.bold("init_experiment"))} ${theme.fg("accent", name)}`;
}
