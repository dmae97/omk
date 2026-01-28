import { formatDistanceToNow } from "date-fns";
import type { MessageStats } from "../types";

interface RequestListProps {
	requests: MessageStats[];
	onSelect: (req: MessageStats) => void;
	title: string;
}

export function RequestList({ requests, onSelect, title }: RequestListProps) {
	return (
		<div
			style={{
				background: "var(--bg-secondary)",
				borderRadius: "12px",
				border: "1px solid var(--border)",
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
				height: "100%",
			}}
		>
			<div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
				<h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
			</div>
			<div style={{ overflowY: "auto", flex: 1 }}>
				<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
					<thead style={{ background: "rgba(0,0,0,0.2)", position: "sticky", top: 0 }}>
						<tr>
							<th
								style={{
									textAlign: "left",
									padding: "12px 20px",
									color: "var(--text-secondary)",
									fontWeight: 500,
								}}
							>
								Time
							</th>
							<th
								style={{
									textAlign: "left",
									padding: "12px 20px",
									color: "var(--text-secondary)",
									fontWeight: 500,
								}}
							>
								Model
							</th>
							<th
								style={{
									textAlign: "right",
									padding: "12px 20px",
									color: "var(--text-secondary)",
									fontWeight: 500,
								}}
							>
								Tokens
							</th>
							<th
								style={{
									textAlign: "right",
									padding: "12px 20px",
									color: "var(--text-secondary)",
									fontWeight: 500,
								}}
							>
								Cost
							</th>
							<th
								style={{
									textAlign: "right",
									padding: "12px 20px",
									color: "var(--text-secondary)",
									fontWeight: 500,
								}}
							>
								Duration
							</th>
							<th
								style={{
									textAlign: "right",
									padding: "12px 20px",
									color: "var(--text-secondary)",
									fontWeight: 500,
								}}
							>
								TTFT
							</th>
							<th
								style={{
									textAlign: "right",
									padding: "12px 20px",
									color: "var(--text-secondary)",
									fontWeight: 500,
								}}
							>
								Tokens/s
							</th>
						</tr>
					</thead>
					<tbody>
						{requests.map(req => (
							<tr
								key={`${req.sessionFile}-${req.entryId}`}
								onClick={() => onSelect(req)}
								style={{
									cursor: "pointer",
									borderBottom: "1px solid var(--border)",
									transition: "background 0.1s",
								}}
								onMouseEnter={e => {
									e.currentTarget.style.background = "rgba(255,255,255,0.05)";
								}}
								onMouseLeave={e => {
									e.currentTarget.style.background = "transparent";
								}}
							>
								<td style={{ padding: "12px 20px" }}>
									{formatDistanceToNow(req.timestamp, { addSuffix: true })}
								</td>
								<td style={{ padding: "12px 20px" }}>
									<div style={{ fontWeight: 500 }}>{req.model}</div>
									<div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{req.provider}</div>
								</td>
								<td style={{ padding: "12px 20px", textAlign: "right" }}>
									{req.usage.totalTokens.toLocaleString()}
								</td>
								<td style={{ padding: "12px 20px", textAlign: "right" }}>${req.usage.cost.total.toFixed(4)}</td>
								<td style={{ padding: "12px 20px", textAlign: "right" }}>
									{req.duration ? `${(req.duration / 1000).toFixed(1)}s` : "-"}
								</td>
								<td style={{ padding: "12px 20px", textAlign: "right" }}>
									{req.ttft ? `${(req.ttft / 1000).toFixed(2)}s` : "-"}
								</td>
								<td style={{ padding: "12px 20px", textAlign: "right" }}>
									{req.duration && req.usage.output
										? ((req.usage.output * 1000) / req.duration).toFixed(1)
										: "-"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
