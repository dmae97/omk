import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { getRequestDetails } from "../api";
import type { RequestDetails } from "../types";

interface RequestDetailProps {
	id: number;
	onClose: () => void;
}

export function RequestDetail({ id, onClose }: RequestDetailProps) {
	const [details, setDetails] = useState<RequestDetails | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		getRequestDetails(id)
			.then(setDetails)
			.catch(console.error)
			.finally(() => setLoading(false));
	}, [id]);

	if (!details && loading) {
		return (
			<div
				style={{
					position: "fixed",
					inset: 0,
					background: "rgba(0,0,0,0.5)",
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					zIndex: 100,
				}}
			>
				<div style={{ background: "var(--bg-secondary)", padding: "20px", borderRadius: "8px" }}>Loading...</div>
			</div>
		);
	}

	if (!details) return null;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop dismissal
		<div
			role="presentation"
			style={{
				position: "fixed",
				inset: 0,
				background: "rgba(0,0,0,0.8)",
				display: "flex",
				justifyContent: "end",
				zIndex: 100,
			}}
			onClick={onClose}
		>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation for modal content */}
			<div
				role="dialog"
				aria-modal="true"
				style={{
					width: "800px",
					maxWidth: "100%",
					background: "var(--bg-primary)",
					height: "100%",
					overflowY: "auto",
					borderLeft: "1px solid var(--border)",
					padding: "30px",
				}}
				onClick={e => e.stopPropagation()}
			>
				<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
					<h2 style={{ margin: 0 }}>Request Details</h2>
					<button
						type="button"
						onClick={onClose}
						style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}
					>
						<X />
					</button>
				</div>

				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "30px" }}>
					<div>
						<div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Model</div>
						<div>
							{details.model} ({details.provider})
						</div>
					</div>
					<div>
						<div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Cost</div>
						<div>${details.usage.cost.total.toFixed(4)}</div>
					</div>
					<div>
						<div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Tokens</div>
						<div>
							{details.usage.totalTokens} (In: {details.usage.input}, Out: {details.usage.output})
						</div>
					</div>
					<div>
						<div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Duration</div>
						<div>{details.duration ? `${(details.duration / 1000).toFixed(2)}s` : "-"}</div>
					</div>
					<div>
						<div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>TTFT</div>
						<div>{details.ttft ? `${(details.ttft / 1000).toFixed(2)}s` : "-"}</div>
					</div>
					<div>
						<div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Tokens/sec</div>
						<div>
							{details.duration && details.usage.output
								? ((details.usage.output * 1000) / details.duration).toFixed(1)
								: "-"}
						</div>
					</div>
				</div>

				<h3 style={{ borderBottom: "1px solid var(--border)", paddingBottom: "10px", marginBottom: "15px" }}>
					Output
				</h3>
				<pre
					style={{
						background: "var(--bg-secondary)",
						padding: "20px",
						borderRadius: "8px",
						whiteSpace: "pre-wrap",
						overflowX: "auto",
						fontSize: "0.9rem",
						fontFamily: "monospace",
					}}
				>
					{JSON.stringify(details.output, null, 2)}
				</pre>

				<h3
					style={{
						borderBottom: "1px solid var(--border)",
						paddingBottom: "10px",
						marginBottom: "15px",
						marginTop: "30px",
					}}
				>
					Raw Metadata
				</h3>
				<pre
					style={{
						background: "var(--bg-secondary)",
						padding: "20px",
						borderRadius: "8px",
						whiteSpace: "pre-wrap",
						overflowX: "auto",
						fontSize: "0.8rem",
						fontFamily: "monospace",
						color: "var(--text-secondary)",
					}}
				>
					{JSON.stringify(details, null, 2)}
				</pre>
			</div>
		</div>
	);
}
