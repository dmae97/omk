import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/omk-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { buildOmkControlSurface, OMK_CONTROL_BRAND_REVISION } from "../../../core/omk-control.ts";
import { theme } from "../theme/theme.ts";
import { formatCwdForFooter, sanitizeStatusText } from "./footer.ts";

export interface OmkControlDashboardActivity {
	label: string;
	detail?: string;
	pendingToolCount?: number;
	queuedMessageCount?: number;
}

interface DashboardTodo {
	id?: number | string;
	text: string;
	done: boolean;
}

const DASHBOARD_MIN_RENDER_WIDTH = 30;
const TODO_LIMIT = 5;

function formatCompactCount(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function getRecordValue(record: unknown, key: string): unknown {
	if (typeof record !== "object" || record === null) return undefined;
	return (record as Record<string, unknown>)[key];
}

function fitToWidth(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = visibleWidth(text) > width ? truncateToWidth(text, width, "") : text;
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export class OmkControlDashboardComponent implements Component {
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private getActivity: () => OmkControlDashboardActivity;

	constructor(
		session: AgentSession,
		footerData: ReadonlyFooterDataProvider,
		getActivity: () => OmkControlDashboardActivity = () => ({ label: "ready", detail: "awaiting route" }),
	) {
		this.session = session;
		this.footerData = footerData;
		this.getActivity = getActivity;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	invalidate(): void {
		// Dynamic view: reads live session/footer state on every render.
	}

	render(width: number, height?: number): string[] {
		if (width < DASHBOARD_MIN_RENDER_WIDTH) return [];

		const w = Math.max(DASHBOARD_MIN_RENDER_WIDTH, width);
		const activity = this.getActivity();
		const lines: string[] = [];

		lines.push(this.borderTop(w));
		lines.push(
			this.frame(this.center(theme.bold(theme.gradient("accent", "borderAccent", "OMK://CONTROL")), w - 2), w),
		);
		lines.push(this.frame(this.center(theme.gradient("warning", "borderAccent", "CYBERPUNK OPS CORE"), w - 2), w));
		lines.push(
			this.frame(
				this.center(theme.gradient("borderAccent", "success", "MATRIX RAIN // NEON GRID ONLINE"), w - 2),
				w,
			),
		);
		lines.push(this.frame(this.center(theme.fg("muted", OMK_CONTROL_BRAND_REVISION), w - 2), w));
		lines.push(this.separator("STATUS", w));
		lines.push(this.row("state", this.formatActivity(activity), w));
		if (activity.detail) lines.push(...this.wrapRow("route", theme.fg("muted", activity.detail), w, 2));

		lines.push(this.separator("TODO", w));
		lines.push(...this.renderTodoRows(activity, w));

		lines.push(this.separator("SESSION", w));
		for (const line of this.getSessionRows()) {
			lines.push(this.row(line.label, line.value, w));
		}

		lines.push(this.separator("MODEL / CTX", w));
		for (const line of this.getModelRows()) {
			lines.push(...this.wrapRow(line.label, line.value, w, 2));
		}

		lines.push(this.separator("RUNTIME / MCP / SKILLS", w));
		for (const line of this.getRuntimeRows()) {
			lines.push(...this.wrapRow(line.label, line.value, w, 2));
		}

		lines.push(this.separator("CONTROL", w));
		const surface = buildOmkControlSurface();
		lines.push(this.row("route", theme.fg("accent", "armed"), w));
		lines.push(this.row("verify", theme.fg("success", "evidence gated"), w));
		lines.push(this.row("loop", theme.fg("muted", "observable"), w));
		lines.push(this.row("mode", theme.fg("dim", surface.compactStatus), w));
		lines.push(this.frame(theme.fg("dim", "Ctrl-C interrupt · / commands · ! shell"), w));
		lines.push(this.borderBottom(w));

		const fitted = lines.map((line) => (visibleWidth(line) > w ? truncateToWidth(line, w, "") : line));
		if (height === undefined || fitted.length <= height) return fitted;
		if (height <= 1) return [this.borderBottom(w)];
		return [...fitted.slice(0, height - 1), this.borderBottom(w)];
	}

	private getSessionRows(): Array<{ label: string; value: string }> {
		const cwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
		const branch = this.footerData.getGitBranch();
		const name = this.session.sessionManager.getSessionName();
		const rows = [
			{ label: "cwd", value: theme.fg("text", cwd) },
			{ label: "git", value: branch ? theme.fg("success", branch) : theme.fg("dim", "none") },
		];
		if (name) rows.push({ label: "name", value: theme.fg("muted", name) });
		return rows;
	}

	private getModelRows(): Array<{ label: string; value: string }> {
		const state = this.session.state;
		const model = state.model;
		const usage = this.collectUsage();
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent === null ? "?" : contextPercentValue.toFixed(1);
		const contextText = `${contextPercent}%/${formatCompactCount(contextWindow)}`;
		const contextColor = contextPercentValue > 90 ? "error" : contextPercentValue > 70 ? "warning" : "success";
		const modelText = model ? `${model.provider}/${model.id}` : "no-model";
		const thinkingText = model?.reasoning ? state.thinkingLevel || "off" : "off";

		return [
			{ label: "model", value: theme.fg("muted", modelText) },
			{ label: "think", value: theme.fg("muted", thinkingText) },
			{
				label: "tok",
				value: theme.fg(
					"muted",
					`↑${formatCompactCount(usage.input)} ↓${formatCompactCount(usage.output)} R${formatCompactCount(usage.cacheRead)} W${formatCompactCount(usage.cacheWrite)}`,
				),
			},
			{ label: "cost", value: theme.fg("muted", `$${usage.cost.toFixed(3)}`) },
			{ label: "ctx", value: theme.fg(contextColor, contextText) },
		];
	}

	private getRuntimeRows(): Array<{ label: string; value: string }> {
		const rows: Array<{ label: string; value: string }> = [];
		const statuses = Array.from(this.footerData.getExtensionStatuses().entries()).sort(([a], [b]) =>
			a.localeCompare(b),
		);
		for (const [key, value] of statuses.slice(0, 4)) {
			rows.push({ label: key, value: theme.fg("muted", sanitizeStatusText(value)) });
		}
		if (rows.length === 0) {
			rows.push({ label: "omk", value: theme.fg("dim", "runtime status pending") });
		}

		try {
			const skills = this.session.resourceLoader.getSkills().skills.length;
			const prompts = this.session.promptTemplates.length;
			const extensions = this.session.resourceLoader.getExtensions().extensions.length;
			rows.push({
				label: "res",
				value: theme.fg("muted", `skills:${skills} prompts:${prompts} ext:${extensions}`),
			});
		} catch {
			rows.push({ label: "res", value: theme.fg("dim", "resource scan unavailable") });
		}
		return rows;
	}

	private collectUsage(): { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number } {
		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		let cost = 0;

		for (const entry of this.session.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				input += entry.message.usage.input;
				output += entry.message.usage.output;
				cacheRead += entry.message.usage.cacheRead;
				cacheWrite += entry.message.usage.cacheWrite;
				cost += entry.message.usage.cost.total;
			}
		}

		return { input, output, cacheRead, cacheWrite, cost };
	}

	private renderTodoRows(activity: OmkControlDashboardActivity, width: number): string[] {
		const todos = this.extractTodos();
		const open = todos.filter((todo) => !todo.done);
		const doneCount = todos.length - open.length;
		const rows: string[] = [];

		if (todos.length > 0) {
			rows.push(
				this.row(
					"open",
					theme.fg(open.length > 0 ? "warning" : "success", `${open.length}/${todos.length}`) +
						theme.fg("dim", ` done:${doneCount}`),
					width,
				),
			);
			for (const todo of open.slice(0, TODO_LIMIT)) {
				rows.push(...this.wrapTodo(todo, width));
			}
			if (open.length > TODO_LIMIT) {
				rows.push(this.frame(theme.fg("dim", `  … ${open.length - TODO_LIMIT} more open`), width));
			}
			if (open.length === 0) {
				rows.push(this.frame(theme.fg("success", "  ✓ all branch todos closed"), width));
			}
			return rows;
		}

		const derived = this.deriveTodosFromActivity(activity);
		for (const item of derived) {
			rows.push(...this.wrapRow("next", theme.fg("muted", item), width, 2));
		}
		return rows;
	}

	private deriveTodosFromActivity(activity: OmkControlDashboardActivity): string[] {
		const items: string[] = [];
		if ((activity.pendingToolCount ?? 0) > 0) {
			items.push(`watch ${activity.pendingToolCount} active tool${activity.pendingToolCount === 1 ? "" : "s"}`);
		}
		if ((activity.queuedMessageCount ?? 0) > 0) {
			items.push(
				`drain ${activity.queuedMessageCount} queued prompt${activity.queuedMessageCount === 1 ? "" : "s"}`,
			);
		}
		if (items.length === 0) items.push("add branch TODOs with the todo tool or /todos");
		return items;
	}

	private extractTodos(): DashboardTodo[] {
		let latest: DashboardTodo[] = [];
		const entries = this.session.sessionManager.getBranch?.() ?? this.session.sessionManager.getEntries();
		for (const entry of entries) {
			if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "todo") {
				const parsed = this.parseTodoList(getRecordValue(entry.message.details, "todos"));
				if (parsed) latest = parsed;
				continue;
			}
			if (entry.type === "custom" && entry.customType.toLowerCase().includes("todo")) {
				const parsed = this.parseTodoList(getRecordValue(entry.data, "todos"));
				if (parsed) latest = parsed;
			}
		}
		return latest;
	}

	private parseTodoList(value: unknown): DashboardTodo[] | undefined {
		if (!Array.isArray(value)) return undefined;
		const todos: DashboardTodo[] = [];
		for (const item of value) {
			const text = getRecordValue(item, "text");
			if (typeof text !== "string" || text.trim().length === 0) continue;
			const id = getRecordValue(item, "id");
			todos.push({
				text: text.trim(),
				done: Boolean(getRecordValue(item, "done")),
				...(typeof id === "number" || typeof id === "string" ? { id } : {}),
			});
		}
		return todos;
	}

	private formatActivity(activity: OmkControlDashboardActivity): string {
		const pending = activity.pendingToolCount ? theme.fg("warning", ` tools:${activity.pendingToolCount}`) : "";
		const queued = activity.queuedMessageCount ? theme.fg("warning", ` queue:${activity.queuedMessageCount}`) : "";
		return (
			theme.fg(activity.label.includes("ready") ? "success" : "accent", `● ${activity.label}`) + pending + queued
		);
	}

	private wrapTodo(todo: DashboardTodo, width: number): string[] {
		const marker = todo.done ? theme.fg("success", "✓") : theme.fg("warning", "○");
		const id = todo.id === undefined ? "" : `${theme.fg("accent", `#${todo.id}`)} `;
		const text = todo.done ? theme.fg("dim", todo.text) : theme.fg("text", todo.text);
		return this.wrapRow(marker, `${id}${text}`, width, 3);
	}

	private row(label: string, value: string, width: number): string {
		const prefix = label.length > 0 ? `${label}:` : " ";
		return this.frame(`${theme.fg("dim", prefix)} ${value}`, width);
	}

	private wrapRow(label: string, value: string, width: number, maxLines: number): string[] {
		const innerWidth = Math.max(1, width - 12);
		const wrapped = wrapTextWithAnsi(value, innerWidth).slice(0, maxLines);
		return wrapped.map((line, index) => this.row(index === 0 ? label : "", line, width));
	}

	private center(text: string, width: number): string {
		const textWidth = visibleWidth(text);
		if (textWidth >= width) return truncateToWidth(text, width, "");
		const left = Math.floor((width - textWidth) / 2);
		const right = width - textWidth - left;
		return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
	}

	private separator(label: string, width: number): string {
		const inner = Math.max(1, width - 2);
		const raw = ` ${label} `;
		const left = Math.max(1, Math.floor((inner - raw.length) / 2));
		const right = Math.max(0, inner - raw.length - left);
		return (
			theme.fg("border", `├${"─".repeat(left)}`) +
			theme.fg("accent", raw) +
			theme.fg("border", `${"─".repeat(right)}┤`)
		);
	}

	private borderTop(width: number): string {
		return theme.fg("borderAccent", `╭${"─".repeat(Math.max(0, width - 2))}╮`);
	}

	private borderBottom(width: number): string {
		return theme.fg("borderAccent", `╰${"─".repeat(Math.max(0, width - 2))}╯`);
	}

	private frame(content: string, width: number): string {
		const inner = Math.max(0, width - 2);
		return theme.fg("border", "│") + fitToWidth(content, inner) + theme.fg("border", "│");
	}
}
