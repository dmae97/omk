import type { ReactNode } from "react";

interface StatCardProps {
	title: string;
	value: string | number;
	detail?: string;
	icon?: ReactNode;
	color?: string;
}

export function StatCard({ title, value, detail, icon, color = "#4ade80" }: StatCardProps) {
	return (
		<div
			style={{
				background: "var(--bg-secondary)",
				padding: "20px",
				borderRadius: "12px",
				border: "1px solid var(--border)",
				display: "flex",
				flexDirection: "column",
				gap: "8px",
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
				<h3 style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: 500 }}>{title}</h3>
				{icon && <div style={{ color }}>{icon}</div>}
			</div>
			<div style={{ fontSize: "1.8rem", fontWeight: 700 }}>{value}</div>
			{detail && <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{detail}</div>}
		</div>
	);
}
