import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import registerSubagent from "../examples/extensions/subagent/index.ts";
import type { SingleResult } from "../examples/extensions/subagent/subagent-runtime-types.ts";
import type { ExtensionAPI, ToolDefinition } from "../src/core/extensions/types.ts";
import type { SubagentLaneAuthority } from "../src/core/subagent-lane-contract.ts";

export interface ResultDetails {
	results: SingleResult[];
	graph?: { completedNodeIds: string[] };
}

export async function fixture() {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omk-improvement-subagent-"));
	const argv = process.argv[1];
	const agentDir = process.env.OMK_CODING_AGENT_DIR;
	await fs.mkdir(path.join(cwd, ".omk/agents"), { recursive: true });
	await fs.writeFile(
		path.join(cwd, ".omk/agents/fixture.md"),
		"---\nname: fixture\ndescription: Offline fixture\ncapabilities:\n  skills: []\n---\n",
	);
	const script = path.join(cwd, "child.mjs");
	await fs.writeFile(
		script,
		`
import { appendFileSync } from 'node:fs';
const task = process.argv.at(-1);
appendFileSync(${JSON.stringify(path.join(cwd, "starts"))}, task + '\\n');
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
const message = {role:'assistant',content:[{type:'text',text:task.includes('unicode') ? '한글😀' : task}],model:'fixture'};
if(task.includes('exit7')) process.exit(7);
if(task.includes('signal')) process.kill(process.pid, 'SIGTERM');
else if(task.includes('longline')) process.stdout.write('x'.repeat(2 * 1024 * 1024));
else if(task.includes('stderr-limit')) process.stderr.write('한'.repeat(400000));
else if(task.includes('truncated')) process.stdout.write('{"type":"message_end"');
else if(task.includes('events-limit')) { for(let i=0;i<21000;i++) emit({type:'unknown'}); }
else if(task.includes('messages-limit')) { for(let i=0;i<1100;i++) emit({type:'message_end',message}); }
else if(task.includes('total-limit')) { for(let i=0;i<100;i++) emit({type:'unknown',data:'x'.repeat(100000)}); }
else if(task.includes('bad-usage')) emit({type:'message_end',message:{...message,usage:{input:-1}}});
else if(task.includes('duplicate-terminal')) { emit({type:'message_end',message}); emit({type:'prompt_settled',outcome:'completed'}); emit({type:'prompt_settled',outcome:'completed'}); }
else if(task.includes('empty')) { emit({type:'agent_start'}); }
else if(task.includes('unicode')) { const data=Buffer.from(JSON.stringify({type:'message_end',message})+'\\n'); for(const byte of data) {process.stdout.write(Buffer.from([byte])); await new Promise(r=>setImmediate(r));} }
else { if(task.includes('slow')) await new Promise(r=>setTimeout(r,70)); emit({type:'message_end',message}); }
`,
	);
	process.argv[1] = script;
	process.env.OMK_CODING_AGENT_DIR = cwd;
	let tool: ToolDefinition | undefined;
	registerSubagent({
		registerTool(value: ToolDefinition) {
			tool = value;
		},
	} as ExtensionAPI);
	if (!tool) throw new Error("registration failed");
	const registered = tool;
	return {
		tool: registered,
		cwd,
		async execute(params: Record<string, unknown>, authority?: SubagentLaneAuthority, onUpdate?: () => void) {
			return (await registered.execute(
				"fixture-call",
				{ agentScope: "project", confirmProjectAgents: false, ...params },
				new AbortController().signal,
				onUpdate,
				{ cwd, hasUI: false, thinkingLevel: "ultra", getSubagentLaneAuthority: () => authority } as Parameters<
					ToolDefinition["execute"]
				>[4],
			)) as Awaited<ReturnType<ToolDefinition["execute"]>> & { isError?: boolean };
		},
		async starts() {
			return (await fs.readFile(path.join(cwd, "starts"), "utf8").catch(() => "")).trim();
		},
		async cleanup() {
			process.argv[1] = argv;
			if (agentDir === undefined) delete process.env.OMK_CODING_AGENT_DIR;
			else process.env.OMK_CODING_AGENT_DIR = agentDir;
			await fs.rm(cwd, { recursive: true, force: true });
		},
	};
}
