import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { delimiter, join } from "node:path";
import type { Subprocess } from "bun";
import { getAgentDir } from "../config";
import { getShellConfig, killProcessTree } from "../utils/shell";
import { getOrCreateSnapshot } from "../utils/shell-snapshot";
import { logger } from "./logger";

const GATEWAY_DIR_NAME = "python-gateway";
const GATEWAY_INFO_FILE = "gateway.json";
const GATEWAY_LOCK_FILE = "gateway.lock";
const GATEWAY_CLIENT_PREFIX = "client-";
const GATEWAY_STARTUP_TIMEOUT_MS = 30000;
const GATEWAY_IDLE_TIMEOUT_MS = 30000;
const GATEWAY_LOCK_TIMEOUT_MS = GATEWAY_STARTUP_TIMEOUT_MS + 5000;
const GATEWAY_LOCK_RETRY_MS = 50;
const GATEWAY_LOCK_STALE_MS = GATEWAY_STARTUP_TIMEOUT_MS * 2;
const GATEWAY_LOCK_HEARTBEAT_MS = 5000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;

const DEFAULT_ENV_ALLOWLIST = new Set([
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"LC_MESSAGES",
	"TERM",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
	"TMPDIR",
	"TEMP",
	"TMP",
	"XDG_CACHE_HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_RUNTIME_DIR",
	"SSH_AUTH_SOCK",
	"SSH_AGENT_PID",
	"CONDA_PREFIX",
	"CONDA_DEFAULT_ENV",
	"VIRTUAL_ENV",
	"PYTHONPATH",
	"SYSTEMROOT",
	"COMSPEC",
	"WINDIR",
	"USERPROFILE",
	"LOCALAPPDATA",
	"APPDATA",
	"PROGRAMDATA",
	"PATHEXT",
	"USERNAME",
	"HOMEDRIVE",
	"HOMEPATH",
]);

const WINDOWS_ENV_ALLOWLIST = new Set([
	"APPDATA",
	"COMPUTERNAME",
	"COMSPEC",
	"HOMEDRIVE",
	"HOMEPATH",
	"LOCALAPPDATA",
	"NUMBER_OF_PROCESSORS",
	"OS",
	"PATH",
	"PATHEXT",
	"PROCESSOR_ARCHITECTURE",
	"PROCESSOR_IDENTIFIER",
	"PROGRAMDATA",
	"PROGRAMFILES",
	"PROGRAMFILES(X86)",
	"PROGRAMW6432",
	"SESSIONNAME",
	"SYSTEMDRIVE",
	"SYSTEMROOT",
	"TEMP",
	"TMP",
	"USERDOMAIN",
	"USERDOMAIN_ROAMINGPROFILE",
	"USERPROFILE",
	"USERNAME",
	"WINDIR",
]);

const DEFAULT_ENV_ALLOW_PREFIXES = ["LC_", "XDG_", "OMP_"];

const DEFAULT_ENV_DENYLIST = new Set([
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"GOOGLE_API_KEY",
	"GEMINI_API_KEY",
	"OPENROUTER_API_KEY",
	"PERPLEXITY_API_KEY",
	"EXA_API_KEY",
	"AZURE_OPENAI_API_KEY",
	"MISTRAL_API_KEY",
]);

const CASE_INSENSITIVE_ENV = process.platform === "win32";
const ACTIVE_ENV_ALLOWLIST = CASE_INSENSITIVE_ENV ? WINDOWS_ENV_ALLOWLIST : DEFAULT_ENV_ALLOWLIST;

const NORMALIZED_ALLOWLIST = new Set(
	Array.from(ACTIVE_ENV_ALLOWLIST, (key) => (CASE_INSENSITIVE_ENV ? key.toUpperCase() : key)),
);
const NORMALIZED_DENYLIST = new Set(
	Array.from(DEFAULT_ENV_DENYLIST, (key) => (CASE_INSENSITIVE_ENV ? key.toUpperCase() : key)),
);
const NORMALIZED_ALLOW_PREFIXES = CASE_INSENSITIVE_ENV
	? DEFAULT_ENV_ALLOW_PREFIXES.map((prefix) => prefix.toUpperCase())
	: DEFAULT_ENV_ALLOW_PREFIXES;

function normalizeEnvKey(key: string): string {
	return CASE_INSENSITIVE_ENV ? key.toUpperCase() : key;
}

function resolvePathKey(env: Record<string, string | undefined>): string {
	if (!CASE_INSENSITIVE_ENV) return "PATH";
	const match = Object.keys(env).find((candidate) => candidate.toLowerCase() === "path");
	return match ?? "PATH";
}

export interface GatewayInfo {
	url: string;
	pid: number;
	startedAt: number;
	refCount: number;
	cwd: string;
	pythonPath?: string;
	venvPath?: string | null;
}

interface GatewayLockInfo {
	pid: number;
	startedAt: number;
}

interface AcquireResult {
	url: string;
	isShared: boolean;
}

let localGatewayProcess: Subprocess | null = null;
let localGatewayUrl: string | null = null;
let idleShutdownTimer: ReturnType<typeof setTimeout> | null = null;
let isCoordinatorInitialized = false;
let localClientFile: string | null = null;

function filterEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
	const filtered: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) continue;
		const normalizedKey = normalizeEnvKey(key);
		if (NORMALIZED_DENYLIST.has(normalizedKey)) continue;
		if (NORMALIZED_ALLOWLIST.has(normalizedKey)) {
			filtered[key] = value;
			continue;
		}
		if (NORMALIZED_ALLOW_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))) {
			filtered[key] = value;
		}
	}
	return filtered;
}

async function resolveVenvPath(cwd: string): Promise<string | null> {
	if (process.env.VIRTUAL_ENV) return process.env.VIRTUAL_ENV;
	const candidates = [join(cwd, ".venv"), join(cwd, "venv")];
	for (const candidate of candidates) {
		if (await Bun.file(candidate).exists()) {
			return candidate;
		}
	}
	return null;
}

async function resolvePythonRuntime(cwd: string, baseEnv: Record<string, string | undefined>) {
	const env = { ...baseEnv };
	const venvPath = env.VIRTUAL_ENV ?? (await resolveVenvPath(cwd));
	if (venvPath) {
		env.VIRTUAL_ENV = venvPath;
		const binDir = process.platform === "win32" ? join(venvPath, "Scripts") : join(venvPath, "bin");
		const pythonCandidate = join(binDir, process.platform === "win32" ? "python.exe" : "python");
		if (await Bun.file(pythonCandidate).exists()) {
			const pathKey = resolvePathKey(env);
			const currentPath = env[pathKey];
			env[pathKey] = currentPath ? `${binDir}${delimiter}${currentPath}` : binDir;
			return { pythonPath: pythonCandidate, env, venvPath };
		}
	}

	const pythonPath = Bun.which("python") ?? Bun.which("python3");
	if (!pythonPath) {
		throw new Error("Python executable not found on PATH");
	}
	return { pythonPath, env, venvPath: null };
}

async function allocatePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address && typeof address === "object") {
				const port = address.port;
				server.close((err: Error | null | undefined) => {
					if (err) {
						reject(err);
					} else {
						resolve(port);
					}
				});
			} else {
				server.close();
				reject(new Error("Failed to allocate port"));
			}
		});
	});
}

function getGatewayDir(): string {
	return join(getAgentDir(), GATEWAY_DIR_NAME);
}

function getGatewayInfoPath(): string {
	return join(getGatewayDir(), GATEWAY_INFO_FILE);
}

function getGatewayLockPath(): string {
	return join(getGatewayDir(), GATEWAY_LOCK_FILE);
}

function writeLockInfo(lockPath: string, fd: number): void {
	const payload: GatewayLockInfo = { pid: process.pid, startedAt: Date.now() };
	try {
		writeFileSync(fd, JSON.stringify(payload));
	} catch {
		try {
			writeFileSync(lockPath, JSON.stringify(payload));
		} catch {
			// Ignore lock write failures
		}
	}
}

function readLockInfo(lockPath: string): GatewayLockInfo | null {
	try {
		const raw = readFileSync(lockPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<GatewayLockInfo>;
		if (typeof parsed.pid === "number" && Number.isFinite(parsed.pid)) {
			return { pid: parsed.pid, startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0 };
		}
	} catch {
		// Ignore parse errors
	}
	return null;
}

function ensureGatewayDir(): void {
	const dir = getGatewayDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

async function withGatewayLock<T>(handler: () => Promise<T>): Promise<T> {
	ensureGatewayDir();
	const lockPath = getGatewayLockPath();
	const start = Date.now();
	while (true) {
		try {
			const fd = openSync(lockPath, "wx");
			const heartbeat = setInterval(() => {
				try {
					const now = new Date();
					utimesSync(lockPath, now, now);
				} catch {
					// Ignore heartbeat errors
				}
			}, GATEWAY_LOCK_HEARTBEAT_MS);
			try {
				writeLockInfo(lockPath, fd);
				return await handler();
			} finally {
				clearInterval(heartbeat);
				try {
					closeSync(fd);
					unlinkSync(lockPath);
				} catch {
					// Ignore lock cleanup errors
				}
			}
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			if (error.code === "EEXIST") {
				let removedStale = false;
				try {
					const stat = statSync(lockPath);
					const lockInfo = readLockInfo(lockPath);
					const lockPid = lockInfo?.pid;
					const lockAgeMs = lockInfo?.startedAt ? Date.now() - lockInfo.startedAt : Date.now() - stat.mtimeMs;
					const staleByTime = lockAgeMs > GATEWAY_LOCK_STALE_MS;
					const staleByPid = lockPid !== undefined && !isPidRunning(lockPid);
					const staleByMissingPid = lockPid === undefined && staleByTime;
					if (staleByPid || staleByMissingPid) {
						unlinkSync(lockPath);
						removedStale = true;
						logger.warn("Removed stale shared gateway lock", { path: lockPath, pid: lockPid });
					}
				} catch {
					// Ignore stat errors; keep waiting
				}
				if (!removedStale) {
					if (Date.now() - start > GATEWAY_LOCK_TIMEOUT_MS) {
						throw new Error("Timed out waiting for shared gateway lock");
					}
					await Bun.sleep(GATEWAY_LOCK_RETRY_MS);
				}
				continue;
			}
			throw err;
		}
	}
}

function readGatewayInfo(): GatewayInfo | null {
	const infoPath = getGatewayInfoPath();
	if (!existsSync(infoPath)) return null;
	try {
		const content = readFileSync(infoPath, "utf-8");
		const parsed = JSON.parse(content) as Partial<GatewayInfo>;
		if (!parsed || typeof parsed !== "object") return null;
		if (typeof parsed.url !== "string" || typeof parsed.pid !== "number" || typeof parsed.startedAt !== "number") {
			return null;
		}
		if (typeof parsed.cwd !== "string") return null;
		const clients = pruneStaleClientInfos(listClientInfos());
		const totalRefCount = clients.reduce((sum, client) => sum + client.info.refCount, 0);
		const recoveredRefCount = clients.length > 0 ? totalRefCount : 0;
		return {
			url: parsed.url,
			pid: parsed.pid,
			startedAt: parsed.startedAt,
			refCount: recoveredRefCount,
			cwd: parsed.cwd,
			pythonPath: typeof parsed.pythonPath === "string" ? parsed.pythonPath : undefined,
			venvPath: typeof parsed.venvPath === "string" || parsed.venvPath === null ? parsed.venvPath : undefined,
		};
	} catch {
		return null;
	}
}

function writeGatewayInfo(info: GatewayInfo): void {
	const infoPath = getGatewayInfoPath();
	const tempPath = `${infoPath}.tmp`;
	writeFileSync(tempPath, JSON.stringify(info, null, 2));
	renameSync(tempPath, infoPath);
}

function clearGatewayInfo(): void {
	const infoPath = getGatewayInfoPath();
	if (existsSync(infoPath)) {
		try {
			unlinkSync(infoPath);
		} catch {
			// Ignore errors on cleanup
		}
	}
}

function isPidRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

interface GatewayClientInfo {
	pid: number;
	refCount: number;
	updatedAt?: number;
}

function getClientFilePath(pid: number): string {
	return join(getGatewayDir(), `${GATEWAY_CLIENT_PREFIX}${pid}.json`);
}

function readClientInfo(path: string): GatewayClientInfo | null {
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as GatewayClientInfo;
		if (typeof parsed.pid !== "number" || typeof parsed.refCount !== "number") return null;
		return parsed;
	} catch {
		return null;
	}
}

function listClientInfos(): Array<{ path: string; info: GatewayClientInfo }> {
	const dir = getGatewayDir();
	if (!existsSync(dir)) return [];
	const entries = readdirSync(dir);
	const results: Array<{ path: string; info: GatewayClientInfo }> = [];
	for (const entry of entries) {
		if (!entry.startsWith(GATEWAY_CLIENT_PREFIX)) continue;
		const path = join(dir, entry);
		const info = readClientInfo(path);
		if (!info) continue;
		results.push({ path, info });
	}
	return results;
}

function pruneStaleClientInfos(
	clients: Array<{ path: string; info: GatewayClientInfo }>,
): Array<{ path: string; info: GatewayClientInfo }> {
	const active: Array<{ path: string; info: GatewayClientInfo }> = [];
	for (const client of clients) {
		if (!isPidRunning(client.info.pid)) {
			try {
				unlinkSync(client.path);
			} catch {
				// Ignore cleanup errors
			}
			continue;
		}
		active.push(client);
	}
	return active;
}

function updateLocalClientRefCount(delta: number): { totalRefCount: number; localRefCount: number } {
	ensureGatewayDir();
	const clients = pruneStaleClientInfos(listClientInfos());
	const localPath = localClientFile ?? getClientFilePath(process.pid);
	const localEntry = clients.find((client) => client.info.pid === process.pid);
	const baseCount = localEntry?.info.refCount ?? 0;
	const nextCount = Math.max(0, baseCount + delta);
	const otherClients = clients.filter((client) => client.info.pid !== process.pid);

	if (nextCount <= 0) {
		if (localEntry) {
			try {
				unlinkSync(localEntry.path);
			} catch {
				// Ignore cleanup errors
			}
		}
		if (localClientFile === localPath) {
			localClientFile = null;
		}
	} else {
		const payload: GatewayClientInfo = { pid: process.pid, refCount: nextCount, updatedAt: Date.now() };
		writeFileSync(localPath, JSON.stringify(payload, null, 2));
		localClientFile = localPath;
	}

	const totalRefCount =
		otherClients.reduce((sum, client) => sum + client.info.refCount, 0) + (nextCount > 0 ? nextCount : 0);
	return { totalRefCount, localRefCount: nextCount };
}

function clearClientFiles(): void {
	const clients = listClientInfos();
	for (const client of clients) {
		try {
			unlinkSync(client.path);
		} catch {
			// Ignore cleanup errors
		}
	}
	localClientFile = null;
}

async function isGatewayHealthy(url: string): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
		const response = await fetch(`${url}/api/kernelspecs`, {
			signal: controller.signal,
		});
		clearTimeout(timeout);
		return response.ok;
	} catch {
		return false;
	}
}

async function isGatewayAlive(info: GatewayInfo): Promise<boolean> {
	if (!isPidRunning(info.pid)) return false;
	return await isGatewayHealthy(info.url);
}

async function startGatewayProcess(
	cwd: string,
): Promise<{ url: string; pid: number; pythonPath: string; venvPath: string | null }> {
	const { shell, env } = await getShellConfig();
	const filteredEnv = filterEnv(env);
	const runtime = await resolvePythonRuntime(cwd, filteredEnv);
	const snapshotPath = await getOrCreateSnapshot(shell, env).catch((err: unknown) => {
		logger.warn("Failed to resolve shell snapshot for shared Python gateway", {
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	});

	const kernelEnv: Record<string, string | undefined> = {
		...runtime.env,
		PYTHONUNBUFFERED: "1",
		OMP_SHELL_SNAPSHOT: snapshotPath ?? undefined,
	};

	const pythonPathParts = [cwd, kernelEnv.PYTHONPATH].filter(Boolean).join(delimiter);
	if (pythonPathParts) {
		kernelEnv.PYTHONPATH = pythonPathParts;
	}

	const gatewayPort = await allocatePort();
	const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

	const gatewayProcess = Bun.spawn(
		[
			runtime.pythonPath,
			"-m",
			"kernel_gateway",
			"--KernelGatewayApp.ip=127.0.0.1",
			`--KernelGatewayApp.port=${gatewayPort}`,
			"--KernelGatewayApp.port_retries=0",
			"--KernelGatewayApp.allow_origin=*",
			"--JupyterApp.answer_yes=true",
		],
		{
			cwd,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: kernelEnv,
		},
	);

	let exited = false;
	gatewayProcess.exited
		.then(() => {
			exited = true;
		})
		.catch(() => {
			exited = true;
		});

	// Wait for gateway to become healthy
	const startTime = Date.now();
	while (Date.now() - startTime < GATEWAY_STARTUP_TIMEOUT_MS) {
		if (exited) {
			throw new Error("Gateway process exited during startup");
		}
		if (await isGatewayHealthy(gatewayUrl)) {
			localGatewayProcess = gatewayProcess;
			localGatewayUrl = gatewayUrl;
			return {
				url: gatewayUrl,
				pid: gatewayProcess.pid,
				pythonPath: runtime.pythonPath,
				venvPath: runtime.venvPath ?? null,
			};
		}
		await Bun.sleep(100);
	}

	killProcessTree(gatewayProcess.pid);
	throw new Error("Gateway startup timeout");
}

function scheduleIdleShutdown(): void {
	if (idleShutdownTimer) {
		clearTimeout(idleShutdownTimer);
	}
	idleShutdownTimer = setTimeout(async () => {
		try {
			await withGatewayLock(async () => {
				const info = readGatewayInfo();
				if (!info) {
					clearClientFiles();
					return;
				}
				const clients = pruneStaleClientInfos(listClientInfos());
				const totalRefCount = clients.reduce((sum, client) => sum + client.info.refCount, 0);
				if (totalRefCount > 0) {
					if (info.refCount !== totalRefCount) {
						writeGatewayInfo({ ...info, refCount: totalRefCount });
					}
					return;
				}
				logger.debug("Shutting down idle shared gateway", { pid: info.pid });
				if (localGatewayProcess) {
					shutdownLocalGateway();
				} else if (isPidRunning(info.pid)) {
					try {
						killProcessTree(info.pid);
					} catch (err) {
						logger.warn("Failed to kill idle shared gateway", {
							error: err instanceof Error ? err.message : String(err),
							pid: info.pid,
						});
					}
				}
				clearGatewayInfo();
				clearClientFiles();
			});
		} catch (err) {
			logger.warn("Failed to shutdown idle shared gateway", {
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			idleShutdownTimer = null;
		}
	}, GATEWAY_IDLE_TIMEOUT_MS);
}

function cancelIdleShutdown(): void {
	if (idleShutdownTimer) {
		clearTimeout(idleShutdownTimer);
		idleShutdownTimer = null;
	}
}

function shutdownLocalGateway(): void {
	if (localGatewayProcess) {
		try {
			killProcessTree(localGatewayProcess.pid);
		} catch (err) {
			logger.warn("Failed to kill shared gateway process", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		localGatewayProcess = null;
		localGatewayUrl = null;
	}
}

export async function acquireSharedGateway(cwd: string): Promise<AcquireResult | null> {
	if (process.env.BUN_ENV === "test" || process.env.NODE_ENV === "test") {
		return null;
	}

	try {
		return await withGatewayLock(async () => {
			const existingInfo = readGatewayInfo();
			if (existingInfo && (await isGatewayAlive(existingInfo))) {
				const { env } = await getShellConfig();
				const filteredEnv = filterEnv(env);
				const runtime = await resolvePythonRuntime(cwd, filteredEnv);
				const existingVenv = existingInfo.venvPath ?? null;
				const runtimeVenv = runtime.venvPath ?? null;
				if (
					existingInfo.cwd !== cwd ||
					!existingInfo.pythonPath ||
					existingInfo.pythonPath !== runtime.pythonPath ||
					existingVenv !== runtimeVenv
				) {
					logger.debug("Shared gateway metadata mismatch", {
						existingCwd: existingInfo.cwd,
						requestedCwd: cwd,
						existingPython: existingInfo.pythonPath,
						runtimePython: runtime.pythonPath,
						existingVenv,
						runtimeVenv,
					});
					return null;
				}
				const { totalRefCount } = updateLocalClientRefCount(1);
				const updatedInfo = { ...existingInfo, refCount: totalRefCount };
				writeGatewayInfo(updatedInfo);
				cancelIdleShutdown();
				logger.debug("Reusing shared gateway", { url: existingInfo.url, refCount: updatedInfo.refCount });
				isCoordinatorInitialized = true;
				return { url: existingInfo.url, isShared: true };
			}

			if (existingInfo) {
				logger.debug("Cleaning up stale gateway info", { pid: existingInfo.pid });
				if (isPidRunning(existingInfo.pid)) {
					try {
						killProcessTree(existingInfo.pid);
					} catch (err) {
						logger.warn("Failed to kill stale shared gateway process", {
							error: err instanceof Error ? err.message : String(err),
							pid: existingInfo.pid,
						});
					}
				}
				clearGatewayInfo();
				clearClientFiles();
			}

			const { url, pid, pythonPath, venvPath } = await startGatewayProcess(cwd);
			const { totalRefCount } = updateLocalClientRefCount(1);
			const info: GatewayInfo = {
				url,
				pid,
				startedAt: Date.now(),
				refCount: totalRefCount,
				cwd,
				pythonPath,
				venvPath,
			};
			writeGatewayInfo(info);
			isCoordinatorInitialized = true;
			logger.debug("Started shared gateway", { url, pid });
			return { url, isShared: true };
		});
	} catch (err) {
		logger.warn("Failed to acquire shared gateway, falling back to local", {
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

export async function releaseSharedGateway(): Promise<void> {
	if (!isCoordinatorInitialized) return;

	try {
		await withGatewayLock(async () => {
			const { totalRefCount } = updateLocalClientRefCount(-1);
			const info = readGatewayInfo();
			if (!info) return;

			const newRefCount = Math.max(0, totalRefCount);
			if (newRefCount === 0) {
				const updatedInfo = { ...info, refCount: 0 };
				writeGatewayInfo(updatedInfo);
				scheduleIdleShutdown();
				logger.debug("Scheduled idle shutdown for shared gateway", { pid: info.pid });
				return;
			}
			const updatedInfo = { ...info, refCount: newRefCount };
			writeGatewayInfo(updatedInfo);
			logger.debug("Released shared gateway reference", { url: info.url, refCount: newRefCount });
		});
	} catch (err) {
		logger.warn("Failed to release shared gateway", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

export function getSharedGatewayUrl(): string | null {
	return localGatewayUrl;
}

export function isSharedGatewayActive(): boolean {
	return localGatewayProcess !== null && localGatewayUrl !== null;
}

export interface GatewayStatus {
	active: boolean;
	shared: boolean;
	url: string | null;
	pid: number | null;
	refCount: number;
	cwd: string | null;
	uptime: number | null;
}

export function getGatewayStatus(): GatewayStatus {
	const info = readGatewayInfo();
	if (!info) {
		return {
			active: false,
			shared: false,
			url: null,
			pid: null,
			refCount: 0,
			cwd: null,
			uptime: null,
		};
	}
	const active = isPidRunning(info.pid);
	const clients = pruneStaleClientInfos(listClientInfos());
	const clientRefCount = clients.reduce((sum, client) => sum + client.info.refCount, 0);
	const refCount = clientRefCount > 0 ? clientRefCount : info.refCount;
	return {
		active,
		shared: active && refCount > 1,
		url: info.url,
		pid: info.pid,
		refCount,
		cwd: info.cwd,
		uptime: Date.now() - info.startedAt,
	};
}

export async function shutdownSharedGateway(): Promise<void> {
	cancelIdleShutdown();
	try {
		await withGatewayLock(async () => {
			const info = readGatewayInfo();
			if (info) {
				clearGatewayInfo();
			}
			clearClientFiles();
		});
	} catch (err) {
		logger.warn("Failed to shutdown shared gateway", {
			error: err instanceof Error ? err.message : String(err),
		});
	} finally {
		shutdownLocalGateway();
		isCoordinatorInitialized = false;
	}
}
