import { EventEmitter } from "events";
import { type Postcondition, PostconditionVerifier, type VerificationResult } from "./automation/index.ts";

export interface BrowserTask {
	url: string;
	task: string;
	sessionId?: string;
	postconditions?: Postcondition[];
}

export interface PageState {
	url: string;
	title: string;
	links: string[];
	forms: { action: string; fields: string[] }[];
	text?: string;
	status?: number;
	error?: string;
}

export interface BrowserUseResult {
	success: boolean;
	pageState: PageState;
	taskCompletion: number;
	pageQuality: number;
	navEfficiency: number;
	safety: number;
	overallScore: number;
	screenshot?: string;
	verification: VerificationResult;
	repairsAttempted: number;
}

export class BrowserUseEngine extends EventEmitter {
	async navigate(url: string): Promise<PageState> {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 10000);
			try {
				const response = await fetch(url, { signal: controller.signal });
				const html = await response.text();
				return this.parseHTML(html, response.url || url, response.status);
			} finally {
				clearTimeout(timeout);
			}
		} catch (error) {
			return {
				url,
				title: "Error",
				links: [],
				forms: [],
				text: "",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private parseHTML(html: string, url: string, status: number): PageState {
		const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
		const links = [...html.matchAll(/href="([^"]+)"/gi)]
			.map((match) => match[1])
			.filter((link) => link.startsWith("http"));
		const forms = [...html.matchAll(/<form[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/gi)].map((match) => ({
			action: match[1] || url,
			fields: [...match[2].matchAll(/name="([^"]*)"/gi)].map((field) => field[1]),
		}));
		const text = html
			.replace(/<script[\s\S]*?<\/script>/gi, "")
			.replace(/<style[\s\S]*?<\/style>/gi, "")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		return {
			url,
			title: titleMatch?.[1] || "No Title",
			links: [...new Set(links)].slice(0, 20),
			forms,
			text,
			status,
		};
	}
}

export class BrowserUseEvaluator extends EventEmitter {
	evaluate(result: BrowserUseResult): { passed: boolean; score: number } {
		const passed = result.overallScore >= 0.6 && result.safety >= 0.5 && result.verification.pass;
		return { passed, score: result.overallScore };
	}
}

export class BrowserUseAgent extends EventEmitter {
	private engine: BrowserUseEngine;
	private evaluator: BrowserUseEvaluator;
	private sessions: Map<string, PageState> = new Map();
	private verifier: PostconditionVerifier;

	constructor() {
		super();
		this.engine = new BrowserUseEngine();
		this.evaluator = new BrowserUseEvaluator();
		this.verifier = new PostconditionVerifier();
	}

	async execute(task: BrowserTask): Promise<BrowserUseResult> {
		const pageState = await this.engine.navigate(task.url);
		this.sessions.set(task.sessionId || "default", pageState);
		const verification = await this.verifier.verify(task.postconditions ?? [{ kind: "text", pattern: "\\S" }], {
			currentUrl: pageState.url,
			text: pageState.text ?? "",
			apiStatus: pageState.status,
		});
		const observed = pageState.error === undefined && (pageState.status === undefined || pageState.status < 500);
		const taskCompletion = verification.pass ? 1 : observed ? 0.4 : 0;
		const pageQuality = observed
			? Math.min(
					1,
					(pageState.links.length > 0 ? 0.25 : 0) +
						(pageState.forms.length > 0 ? 0.25 : 0) +
						(pageState.text ? 0.5 : 0),
				)
			: 0;
		const navEfficiency = observed ? 0.9 : 0;
		const safety = verification.failures.length === 0 ? 1 : 0.7;
		const overallScore = Number(
			(taskCompletion * 0.45 + pageQuality * 0.2 + navEfficiency * 0.2 + safety * 0.15).toFixed(2),
		);
		const result: BrowserUseResult = {
			success: observed && verification.pass,
			pageState,
			taskCompletion,
			pageQuality,
			navEfficiency,
			safety,
			overallScore,
			verification,
			repairsAttempted: verification.pass ? 0 : 1,
		};

		const evaluation = this.evaluator.evaluate(result);
		this.emit("taskComplete", { task, result, evaluation });

		return result;
	}

	getSession(sessionId: string): PageState | undefined {
		return this.sessions.get(sessionId);
	}
}

export default BrowserUseAgent;
