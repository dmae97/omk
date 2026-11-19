import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { parseJson } from "./contract-fixture-utils.mjs";

// Direct child only: no npx or intermediary shell may outlive a failed recording.
export async function recordRpc(command, args, options = {}) {
	const { timeoutMs = 120_000, ...spawnOptions } = options;
	const child = spawn(command, args, { ...spawnOptions, stdio: ["pipe", "pipe", "pipe"] });
	const transcript = [];
	const received = [];
	const decoder = new StringDecoder("utf8");
	const waiters = new Set();
	let buffer = "";
	let bytes = 0;
	let failure;
	let closed = false;
	const notify = () => { for (const waiter of [...waiters]) waiter(); };
	const fail = (error) => { failure ??= error; notify(); };
	child.once("error", () => fail(new Error("RPC driver spawn failed")));
	child.stdin.on("error", () => fail(new Error("RPC driver stdin failed")));
	child.stderr.resume();
	child.stdout.on("data", (chunk) => {
		try {
			bytes += chunk.length;
			if (bytes > 8 * 1024 * 1024) throw new Error("RPC output budget exceeded");
			buffer += decoder.write(chunk);
			if (Buffer.byteLength(buffer) > 1024 * 1024) throw new Error("RPC frame budget exceeded");
			let index;
			while ((index = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				if (!line.trim()) continue;
				const message = parseJson(line);
				received.push(message);
				transcript.push({ direction: "out", message });
			}
			notify();
		} catch (error) { fail(error); }
	});
	const close = new Promise((resolve) => child.once("close", (code, signal) => {
		closed = true;
		buffer += decoder.end();
		if (buffer.trim()) fail(new Error("RPC driver left an unterminated JSONL frame"));
		if (code !== 0 || signal) fail(new Error("RPC driver exited unsuccessfully"));
		notify();
		resolve();
	}));
	const waitFor = (predicate, label) => new Promise((resolve, reject) => {
		const finish = (error) => {
			clearTimeout(timer);
			waiters.delete(check);
			if (error) reject(error); else resolve();
		};
		const check = () => {
			try {
				if (failure) return finish(failure);
				if (predicate()) return finish();
				if (closed) finish(new Error(`RPC driver closed before ${label}`));
			} catch (error) { finish(error); }
		};
		const timer = setTimeout(() => finish(new Error(`RPC timeout: ${label}`)), timeoutMs);
		waiters.add(check);
		check();
	});
	const send = (message) => {
		if (failure || closed) throw failure ?? new Error("RPC driver is closed");
		transcript.push({ direction: "in", message });
		child.stdin.write(`${JSON.stringify(message)}\n`);
	};
	const response = (id, commandName) => () => {
		const reply = received.find((message) => message.type === "response" && message.id === id && message.command === commandName);
		if (!reply) return false;
		if (reply.success !== true) throw new Error(`RPC command rejected: ${commandName}`);
		return true;
	};
	try {
		send({ id: "state-1", type: "get_state" });
		await waitFor(response("state-1", "get_state"), "get_state response");
		for (const [index, message] of ["hello", "second"].entries()) {
			const id = `prompt-${index + 1}`;
			send({ id, type: "prompt", message });
			await waitFor(response(id, "prompt"), "prompt acknowledgement");
			await waitFor(() => received.filter((item) => item.type === "prompt_settled").length === index + 1, "prompt settlement");
		}
		send({ id: "state-2", type: "get_state" });
		await waitFor(response("state-2", "get_state"), "final state response");
		child.stdin.end();
		await waitFor(() => closed, "clean shutdown");
		await close;
		return transcript;
	} finally {
		if (!closed) { child.kill("SIGKILL"); await close; }
	}
}
