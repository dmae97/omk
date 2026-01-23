import type { DashboardStats, MessageStats, RequestDetails } from "./types";

const API_BASE = "/api";

export async function getStats(): Promise<DashboardStats> {
	const res = await fetch(`${API_BASE}/stats`);
	if (!res.ok) throw new Error("Failed to fetch stats");
	return res.json() as Promise<DashboardStats>;
}

export async function getRecentRequests(limit = 50): Promise<MessageStats[]> {
	const res = await fetch(`${API_BASE}/stats/recent?limit=${limit}`);
	if (!res.ok) throw new Error("Failed to fetch recent requests");
	return res.json() as Promise<MessageStats[]>;
}

export async function getRecentErrors(limit = 50): Promise<MessageStats[]> {
	const res = await fetch(`${API_BASE}/stats/errors?limit=${limit}`);
	if (!res.ok) throw new Error("Failed to fetch recent errors");
	return res.json() as Promise<MessageStats[]>;
}

export async function getRequestDetails(id: number): Promise<RequestDetails> {
	const res = await fetch(`${API_BASE}/request/${id}`);
	if (!res.ok) throw new Error("Failed to fetch request details");
	return res.json() as Promise<RequestDetails>;
}

export async function sync(): Promise<any> {
	const res = await fetch(`${API_BASE}/sync`);
	if (!res.ok) throw new Error("Failed to sync");
	return res.json();
}
