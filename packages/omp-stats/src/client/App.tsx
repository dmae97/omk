import { useEffect, useState } from "react";
import { Activity, AlertCircle, BarChart2, CheckCircle, Database, RefreshCw, Server } from "lucide-react";
import { getRecentErrors, getRecentRequests, getStats, sync } from "./api";
import { RequestDetail } from "./components/RequestDetail";
import { RequestList } from "./components/RequestList";
import { StatCard } from "./components/StatCard";
import type { DashboardStats, MessageStats } from "./types";

export default function App() {
	const [stats, setStats] = useState<DashboardStats | null>(null);
	const [recentRequests, setRecentRequests] = useState<MessageStats[]>([]);
	const [recentErrors, setRecentErrors] = useState<MessageStats[]>([]);
	const [selectedRequest, setSelectedRequest] = useState<number | null>(null);
	const [syncing, setSyncing] = useState(false);
	const [activeTab, setActiveTab] = useState<"overview" | "requests" | "errors">("overview");

	const loadData = async () => {
		try {
			const [s, r, e] = await Promise.all([
				getStats(),
				getRecentRequests(50),
				getRecentErrors(50)
			]);
			setStats(s);
			setRecentRequests(r);
			setRecentErrors(e);
		} catch (err) {
			console.error(err);
		}
	};

	const handleSync = async () => {
		setSyncing(true);
		try {
			await sync();
			await loadData();
		} finally {
			setSyncing(false);
		}
	};

	useEffect(() => {
		loadData();
		const interval = setInterval(loadData, 30000);
		return () => clearInterval(interval);
	}, []);

	if (!stats) return <div style={{ padding: 40, textAlign: "center" }}>Loading stats...</div>;

	return (
		<div style={{ maxWidth: "1400px", margin: "0 auto", padding: "20px" }}>
			<header style={{ 
				display: "flex", justifyContent: "space-between", alignItems: "center",
				marginBottom: "30px", paddingBottom: "20px", borderBottom: "1px solid var(--border)"
			}}>
				<h1 style={{ margin: 0, fontSize: "1.5rem", display: "flex", alignItems: "center", gap: "10px" }}>
					<Activity color="var(--accent)" />
					AI Usage Statistics
				</h1>
				<div style={{ display: "flex", gap: "15px", alignItems: "center" }}>
					<div style={{ display: "flex", background: "var(--bg-secondary)", borderRadius: "6px", padding: "4px" }}>
						{(["overview", "requests", "errors"] as const).map(tab => (
							<button
								key={tab}
								onClick={() => setActiveTab(tab)}
								style={{
									background: activeTab === tab ? "var(--bg-card)" : "transparent",
									color: activeTab === tab ? "var(--text-primary)" : "var(--text-secondary)",
									border: "none", padding: "6px 16px", borderRadius: "4px",
									cursor: "pointer", textTransform: "capitalize", fontWeight: 500
								}}
							>
								{tab}
							</button>
						))}
					</div>
					<button 
						onClick={handleSync}
						disabled={syncing}
						style={{ 
							background: "var(--accent)", color: "white", border: "none",
							padding: "8px 16px", borderRadius: "6px", cursor: "pointer",
							display: "flex", alignItems: "center", gap: "8px", opacity: syncing ? 0.7 : 1
						}}
					>
						<RefreshCw size={16} className={syncing ? "spin" : ""} />
						{syncing ? "Syncing..." : "Sync"}
					</button>
				</div>
			</header>

			{activeTab === "overview" && (
				<>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px", marginBottom: "30px" }}>
						<StatCard 
							title="Total Requests" 
							value={stats.overall.totalRequests.toLocaleString()} 
							detail={`${stats.overall.successfulRequests} success, ${stats.overall.failedRequests} errors`}
							icon={<Server size={20} />}
						/>
						<StatCard 
							title="Total Cost" 
							value={`$${stats.overall.totalCost.toFixed(2)}`} 
							detail={stats.overall.totalRequests > 0 ? `$${(stats.overall.totalCost / stats.overall.totalRequests).toFixed(4)} avg/req` : '-'}
							icon={<Activity size={20} />}
						/>
						<StatCard 
							title="Cache Rate" 
							value={`${(stats.overall.cacheRate * 100).toFixed(1)}%`} 
							detail={`${(stats.overall.totalCacheReadTokens / 1000).toFixed(1)}k cached tokens`}
							icon={<Database size={20} />}
						/>
						<StatCard 
							title="Error Rate" 
							value={`${(stats.overall.errorRate * 100).toFixed(1)}%`} 
							detail={`${stats.overall.failedRequests} failed requests`}
							icon={<AlertCircle size={20} />}
							color="var(--error)"
						/>
						<StatCard 
							title="Tokens/Sec" 
							value={stats.overall.avgTokensPerSecond?.toFixed(1) ?? "-"} 
							detail={`${(stats.overall.totalInputTokens + stats.overall.totalOutputTokens).toLocaleString()} total tokens`}
							icon={<BarChart2 size={20} />}
						/>
					</div>

					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", height: "400px" }}>
						<RequestList 
							title="Recent Requests" 
							requests={recentRequests} 
							onSelect={(r) => r.id && setSelectedRequest(r.id)} 
						/>
						<RequestList 
							title="Recent Errors" 
							requests={recentErrors} 
							onSelect={(r) => r.id && setSelectedRequest(r.id)} 
						/>
					</div>
				</>
			)}

			{activeTab === "requests" && (
				<div style={{ height: "calc(100vh - 150px)" }}>
					<RequestList 
						title="All Recent Requests" 
						requests={recentRequests} 
						onSelect={(r) => r.id && setSelectedRequest(r.id)} 
					/>
				</div>
			)}

			{activeTab === "errors" && (
				<div style={{ height: "calc(100vh - 150px)" }}>
					<RequestList 
						title="Failed Requests" 
						requests={recentErrors} 
						onSelect={(r) => r.id && setSelectedRequest(r.id)} 
					/>
				</div>
			)}

			{selectedRequest !== null && (
				<RequestDetail id={selectedRequest} onClose={() => setSelectedRequest(null)} />
			)}
		</div>
	);
}
