import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, XCircle } from "lucide-react";
import type { MessageStats } from "../types";

interface RequestListProps {
	requests: MessageStats[];
	onSelect: (req: MessageStats) => void;
	title: string;
}

export function RequestList({ requests, onSelect, title }: RequestListProps) {
	return (
		<div className="surface overflow-hidden flex flex-col h-full">
			<div className="px-5 py-4 border-b border-[var(--border-subtle)]">
				<h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
			</div>
			<div className="overflow-auto flex-1">
				<table className="w-full">
					<thead className="bg-[var(--bg-elevated)] sticky top-0 z-10">
						<tr>
							<th className="text-left py-3 px-4 table-header">Model</th>
							<th className="text-left py-3 px-4 table-header">Time</th>
							<th className="text-right py-3 px-4 table-header">Tokens</th>
							<th className="text-right py-3 px-4 table-header">Cost</th>
							<th className="text-right py-3 px-4 table-header">Duration</th>
							<th className="text-center py-3 px-4 table-header">Status</th>
						</tr>
					</thead>
					<tbody>
						{requests.map(req => (
							<tr
								key={`${req.sessionFile}-${req.entryId}`}
								onClick={() => onSelect(req)}
								className="table-row cursor-pointer border-b border-[var(--border-subtle)] last:border-b-0"
							>
								<td className="py-3 px-4">
									<div className="font-medium text-[var(--text-primary)] text-sm">{req.model}</div>
									<div className="text-xs text-[var(--text-muted)]">{req.provider}</div>
								</td>
								<td className="py-3 px-4 text-sm text-[var(--text-secondary)]">
									{formatDistanceToNow(req.timestamp, { addSuffix: true })}
								</td>
								<td className="py-3 px-4 text-right text-sm text-[var(--text-secondary)] font-mono">
									{req.usage.totalTokens.toLocaleString()}
								</td>
								<td className="py-3 px-4 text-right text-sm text-[var(--text-secondary)] font-mono">
									${req.usage.cost.total.toFixed(4)}
								</td>
								<td className="py-3 px-4 text-right text-sm text-[var(--text-secondary)] font-mono">
									{req.duration ? `${(req.duration / 1000).toFixed(1)}s` : "-"}
								</td>
								<td className="py-3 px-4 text-center">
									{req.errorMessage ? (
										<XCircle size={16} className="text-[var(--accent-red)] mx-auto" />
									) : (
										<CheckCircle2 size={16} className="text-[var(--accent-green)] mx-auto" />
									)}
								</td>
							</tr>
						))}
						{requests.length === 0 && (
							<tr>
								<td colSpan={6} className="py-12 text-center text-[var(--text-muted)] text-sm">
									No requests found
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}
