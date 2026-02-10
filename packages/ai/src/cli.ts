#!/usr/bin/env bun
import * as readline from "node:readline";
import { CliAuthStorage } from "./storage";
import { getOAuthProviders } from "./utils/oauth";
import { loginAnthropic } from "./utils/oauth/anthropic";
import { loginCursor } from "./utils/oauth/cursor";
import { loginGitHubCopilot } from "./utils/oauth/github-copilot";
import { loginAntigravity } from "./utils/oauth/google-antigravity";
import { loginGeminiCli } from "./utils/oauth/google-gemini-cli";
import { loginKimi } from "./utils/oauth/kimi";
import { loginOpenAICodex } from "./utils/oauth/openai-codex";
import type { OAuthCredentials, OAuthProvider } from "./utils/oauth/types";

const PROVIDERS = getOAuthProviders();

function prompt(rl: readline.Interface, question: string): Promise<string> {
	const { promise, resolve } = Promise.withResolvers<string>();
	rl.question(question, resolve);
	return promise;
}

async function login(provider: OAuthProvider): Promise<void> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	const promptFn = (msg: string) => prompt(rl, `${msg} `);
	const storage = await CliAuthStorage.create();

	try {
		let credentials: OAuthCredentials;

		switch (provider) {
			case "anthropic":
				credentials = await loginAnthropic({
					onAuth(info) {
						const { url } = info;
						console.log(`\nOpen this URL in your browser:\n${url}\n`);
					},
					onProgress(message) {
						console.log(message);
					},
				});
				break;

			case "github-copilot":
				credentials = await loginGitHubCopilot({
					onAuth(url, instructions) {
						console.log(`\nOpen this URL in your browser:\n${url}`);
						if (instructions) console.log(instructions);
						console.log();
					},
					async onPrompt(p) {
						return await promptFn(`${p.message}${p.placeholder ? ` (${p.placeholder})` : ""}:`);
					},
				});
				break;

			case "google-gemini-cli":
				credentials = await loginGeminiCli({
					onAuth(info) {
						const { url, instructions } = info;
						console.log(`\nOpen this URL in your browser:\n${url}`);
						if (instructions) console.log(instructions);
						console.log();
					},
				});
				break;

			case "google-antigravity":
				credentials = await loginAntigravity({
					onAuth(info) {
						const { url, instructions } = info;
						console.log(`\nOpen this URL in your browser:\n${url}`);
						if (instructions) console.log(instructions);
						console.log();
					},
				});
				break;
			case "openai-codex":
				credentials = await loginOpenAICodex({
					onAuth(info) {
						const { url, instructions } = info;
						console.log(`\nOpen this URL in your browser:\n${url}`);
						if (instructions) console.log(instructions);
						console.log();
					},
					async onPrompt(p) {
						return await promptFn(`${p.message}${p.placeholder ? ` (${p.placeholder})` : ""}:`);
					},
				});
				break;

			case "kimi-code":
				credentials = await loginKimi({
					onAuth(info) {
						const { url, instructions } = info;
						console.log(`\nOpen this URL in your browser:\n${url}`);
						if (instructions) console.log(instructions);
						console.log();
					},
				});
				break;

			case "cursor":
				credentials = await loginCursor(
					url => {
						console.log(`\nOpen this URL in your browser:\n${url}\n`);
					},
					() => {
						console.log("Waiting for browser authentication...");
					},
				);
				break;

			default:
				throw new Error(`Unknown provider: ${provider}`);
		}

		storage.saveOAuth(provider, credentials);

		console.log(`\nCredentials saved to ~/.omp/agent/agent.db`);
	} finally {
		storage.close();
		rl.close();
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "help" || command === "--help" || command === "-h") {
		console.log(`Usage: bunx @oh-my-pi/pi-ai <command> [provider]

Commands:
  login [provider]  Login to an OAuth provider
  logout [provider] Logout from an OAuth provider
  status            Show logged-in providers
  list              List available providers

Providers:
  anthropic         Anthropic (Claude Pro/Max)
  github-copilot    GitHub Copilot
  google-gemini-cli Google Gemini CLI
  google-antigravity Antigravity (Gemini 3, Claude, GPT-OSS)
  openai-codex      OpenAI Codex (ChatGPT Plus/Pro)
  kimi-code        Kimi Code
  cursor            Cursor (Claude, GPT, etc.)

Examples:
  bunx @oh-my-pi/pi-ai login              # interactive provider selection
  bunx @oh-my-pi/pi-ai login anthropic    # login to specific provider
  bunx @oh-my-pi/pi-ai logout anthropic   # logout from specific provider
  bunx @oh-my-pi/pi-ai status             # show logged-in providers
  bunx @oh-my-pi/pi-ai list               # list providers
`);
		return;
	}

	if (command === "status") {
		const storage = await CliAuthStorage.create();
		try {
			const providers = storage.listProviders();
			if (providers.length === 0) {
				console.log("No OAuth credentials stored.");
				console.log(`Use 'bunx @oh-my-pi/pi-ai login' to authenticate.`);
			} else {
				console.log("Logged-in providers:\n");
				for (const provider of providers) {
					const oauth = storage.getOAuth(provider);
					if (oauth) {
						const expires = new Date(oauth.expires);
						const expired = Date.now() >= oauth.expires;
						const status = expired ? "(expired)" : `(expires ${expires.toLocaleString()})`;
						console.log(`  ${provider.padEnd(20)} ${status}`);
					}
				}
			}
		} finally {
			storage.close();
		}
		return;
	}

	if (command === "list") {
		console.log("Available OAuth providers:\n");
		for (const p of PROVIDERS) {
			console.log(`  ${p.id.padEnd(20)} ${p.name}`);
		}
		return;
	}

	if (command === "logout") {
		let provider = args[1] as OAuthProvider | undefined;
		const storage = await CliAuthStorage.create();

		try {
			if (!provider) {
				const providers = storage.listProviders();
				if (providers.length === 0) {
					console.log("No OAuth credentials stored.");
					return;
				}

				const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
				console.log("Select a provider to logout:\n");
				for (let i = 0; i < providers.length; i++) {
					console.log(`  ${i + 1}. ${providers[i]}`);
				}
				console.log();

				const choice = await prompt(rl, `Enter number (1-${providers.length}): `);
				rl.close();

				const index = parseInt(choice, 10) - 1;
				if (index < 0 || index >= providers.length) {
					console.error("Invalid selection");
					process.exit(1);
				}
				provider = providers[index] as OAuthProvider;
			}

			const oauth = storage.getOAuth(provider);
			if (!oauth) {
				console.error(`Not logged in to ${provider}`);
				process.exit(1);
			}

			storage.deleteProvider(provider);
			console.log(`Logged out from ${provider}`);
		} finally {
			storage.close();
		}
		return;
	}

	if (command === "login") {
		let provider = args[1] as OAuthProvider | undefined;

		if (!provider) {
			const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
			console.log("Select a provider:\n");
			for (let i = 0; i < PROVIDERS.length; i++) {
				console.log(`  ${i + 1}. ${PROVIDERS[i].name}`);
			}
			console.log();

			const choice = await prompt(rl, `Enter number (1-${PROVIDERS.length}): `);
			rl.close();

			const index = parseInt(choice, 10) - 1;
			if (index < 0 || index >= PROVIDERS.length) {
				console.error("Invalid selection");
				process.exit(1);
			}
			provider = PROVIDERS[index].id;
		}

		if (!PROVIDERS.some(p => p.id === provider)) {
			console.error(`Unknown provider: ${provider}`);
			console.error(`Use 'bunx @oh-my-pi/pi-ai list' to see available providers`);
			process.exit(1);
		}

		console.log(`Logging in to ${provider}…`);
		await login(provider);
		return;
	}

	console.error(`Unknown command: ${command}`);
	console.error(`Use 'bunx @oh-my-pi/pi-ai --help' for usage`);
	process.exit(1);
}

main().catch(err => {
	console.error("Error:", err.message);
	process.exit(1);
});
