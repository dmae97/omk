import {
	CategoryScale,
	Chart as ChartJS,
	Legend,
	LinearScale,
	LineElement,
	PointElement,
	Title,
	Tooltip,
} from "chart.js";
import { format } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import type { ModelPerformancePoint, ModelStats } from "../types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const MODEL_COLORS = [
	"#a78bfa", // violet
	"#22d3ee", // cyan
	"#ec4899", // pink
	"#4ade80", // green
	"#fbbf24", // amber
	"#f87171", // red
	"#60a5fa", // blue
];

interface ModelsTableProps {
	models: ModelStats[];
	performanceSeries: ModelPerformancePoint[];
}

type ModelPerformanceSeries = {
	label: string;
	data: Array<{
		timestamp: number;
		avgTtftSeconds: number | null;
		avgTokensPerSecond: number | null;
		requests: number;
	}>;
};

export function ModelsTable({ models, performanceSeries }: ModelsTableProps) {
	const [expandedKey, setExpandedKey] = useState<string | null>(null);

	const performanceSeriesByKey = useMemo(() => buildModelPerformanceLookup(performanceSeries), [performanceSeries]);
	const sortedModels = [...models].sort(
		(a, b) => b.totalInputTokens + b.totalOutputTokens - (a.totalInputTokens + a.totalOutputTokens),
	);

	return (
		<div className="surface overflow-hidden">
			<div className="px-5 py-4 border-b border-[var(--border-subtle)]">
				<h3 className="text-sm font-semibold text-[var(--text-primary)]">Model Statistics</h3>
			</div>

			<div className="overflow-x-auto">
				<div
					className="grid gap-3 px-5 py-3 text-[var(--text-muted)] text-xs uppercase tracking-wider font-semibold"
					style={{ gridTemplateColumns: "2fr 0.9fr 0.9fr 1fr 0.8fr 0.8fr 140px 40px" }}
				>
					<div>Model</div>
					<div className="text-right">Requests</div>
					<div className="text-right">Cost</div>
					<div className="text-right">Tokens</div>
					<div className="text-right">Tokens/s</div>
					<div className="text-right">TTFT</div>
					<div className="text-center">14d Trend</div>
					<div />
				</div>

				<div className="max-h-[calc(100vh-300px)] overflow-y-auto">
					{sortedModels.map((model, index) => {
						const key = `${model.model}::${model.provider}`;
						const performance = performanceSeriesByKey.get(key);
						const trendData = performance?.data ?? [];
						const trendColor = MODEL_COLORS[index % MODEL_COLORS.length];
						const isExpanded = expandedKey === key;
						const errorRate = model.errorRate * 100;

						return (
							<div key={key} className="border-t border-[var(--border-subtle)]">
								<button
									type="button"
									onClick={() => setExpandedKey(isExpanded ? null : key)}
									className="w-full bg-transparent border-none text-left px-5 py-3 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
								>
									<div
										className="grid gap-3 items-center"
										style={{ gridTemplateColumns: "2fr 0.9fr 0.9fr 1fr 0.8fr 0.8fr 140px 40px" }}
									>
										<div>
											<div className="font-medium text-[var(--text-primary)]">{model.model}</div>
											<div className="text-xs text-[var(--text-muted)]">{model.provider}</div>
										</div>
										<div className="text-right text-[var(--text-secondary)] font-mono text-sm">
											{model.totalRequests.toLocaleString()}
										</div>
										<div className="text-right text-[var(--text-secondary)] font-mono text-sm">
											${model.totalCost.toFixed(2)}
										</div>
										<div className="text-right text-[var(--text-secondary)] font-mono text-sm">
											{(model.totalInputTokens + model.totalOutputTokens).toLocaleString()}
										</div>
										<div className="text-right text-[var(--text-secondary)] font-mono text-sm">
											{model.avgTokensPerSecond?.toFixed(1) ?? "-"}
										</div>
										<div className="text-right text-[var(--text-secondary)] font-mono text-sm">
											{model.avgTtft ? `${(model.avgTtft / 1000).toFixed(2)}s` : "-"}
										</div>
										<div className="h-10">
											{trendData.length === 0 ? (
												<div className="text-[var(--text-muted)] text-center text-sm">-</div>
											) : (
												<TrendChart data={trendData} color={trendColor} />
											)}
										</div>
										<div className="flex justify-center text-[var(--text-muted)]">
											{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
										</div>
									</div>
								</button>

								{isExpanded && (
									<div className="px-5 py-4 bg-[var(--bg-elevated)] border-t border-[var(--border-subtle)]">
										<div className="grid gap-4" style={{ gridTemplateColumns: "200px 1fr" }}>
											<div className="space-y-4 text-sm">
												<div>
													<div className="text-[var(--text-primary)] font-medium mb-2">Quality</div>
													<div className="space-y-1 text-[var(--text-secondary)]">
														<div className="flex items-center justify-between">
															<span>Error rate</span>
															<span
																className={
																	errorRate > 5
																		? "text-[var(--accent-red)]"
																		: "text-[var(--accent-green)]"
																}
															>
																{errorRate.toFixed(1)}%
															</span>
														</div>
														<div className="flex items-center justify-between">
															<span>Cache rate</span>
															<span className="text-[var(--accent-cyan)]">
																{(model.cacheRate * 100).toFixed(1)}%
															</span>
														</div>
													</div>
												</div>
												<div>
													<div className="text-[var(--text-primary)] font-medium mb-2">Latency</div>
													<div className="space-y-1 text-[var(--text-secondary)]">
														<div className="flex items-center justify-between">
															<span>Avg duration</span>
															<span className="font-mono">
																{model.avgDuration ? `${(model.avgDuration / 1000).toFixed(2)}s` : "-"}
															</span>
														</div>
														<div className="flex items-center justify-between">
															<span>Avg TTFT</span>
															<span className="font-mono">
																{model.avgTtft ? `${(model.avgTtft / 1000).toFixed(2)}s` : "-"}
															</span>
														</div>
													</div>
												</div>
											</div>
											<div className="h-[200px]">
												{trendData.length === 0 ? (
													<div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">
														No data available
													</div>
												) : (
													<PerformanceChart data={trendData} color={trendColor} />
												)}
											</div>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function TrendChart({
	data,
	color,
}: {
	data: Array<{ timestamp: number; avgTokensPerSecond: number | null }>;
	color: string;
}) {
	const chartData = {
		labels: data.map(d => format(new Date(d.timestamp), "MMM d")),
		datasets: [
			{
				data: data.map(d => d.avgTokensPerSecond ?? 0),
				borderColor: color,
				backgroundColor: "transparent",
				tension: 0.4,
				pointRadius: 0,
				borderWidth: 2,
			},
		],
	};

	const options = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: { legend: { display: false }, tooltip: { enabled: false } },
		scales: {
			x: { display: false },
			y: { display: false, min: 0 },
		},
	};

	return <Line data={chartData} options={options} />;
}

function PerformanceChart({
	data,
	color,
}: {
	data: Array<{ timestamp: number; avgTtftSeconds: number | null; avgTokensPerSecond: number | null }>;
	color: string;
}) {
	const chartData = {
		labels: data.map(d => format(new Date(d.timestamp), "MMM d")),
		datasets: [
			{
				label: "TTFT",
				data: data.map(d => d.avgTtftSeconds ?? null),
				borderColor: "#fbbf24",
				backgroundColor: "transparent",
				tension: 0.4,
				pointRadius: 0,
				borderWidth: 2,
				yAxisID: "y" as const,
			},
			{
				label: "Tokens/s",
				data: data.map(d => d.avgTokensPerSecond ?? null),
				borderColor: color,
				backgroundColor: "transparent",
				tension: 0.4,
				pointRadius: 0,
				borderWidth: 2,
				yAxisID: "y1" as const,
			},
		],
	};

	const options = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: {
				display: true,
				position: "top" as const,
				labels: {
					color: "var(--text-secondary)",
					usePointStyle: true,
					padding: 12,
					font: { size: 10 },
				},
			},
			tooltip: {
				backgroundColor: "var(--bg-elevated)",
				titleColor: "var(--text-primary)",
				bodyColor: "var(--text-secondary)",
				borderColor: "var(--border-default)",
				borderWidth: 1,
				cornerRadius: 8,
			},
		},
		scales: {
			x: {
				grid: { color: "var(--border-subtle)" },
				ticks: { color: "var(--text-muted)", font: { size: 10 } },
			},
			y: {
				type: "linear" as const,
				display: true,
				position: "left" as const,
				grid: { color: "var(--border-subtle)" },
				ticks: { color: "var(--text-muted)", font: { size: 10 } },
			},
			y1: {
				type: "linear" as const,
				display: true,
				position: "right" as const,
				grid: { drawOnChartArea: false },
				ticks: { color: "var(--text-muted)", font: { size: 10 } },
			},
		},
	};

	return <Line data={chartData} options={options} />;
}

function buildModelPerformanceLookup(points: ModelPerformancePoint[], days = 14): Map<string, ModelPerformanceSeries> {
	const dayMs = 24 * 60 * 60 * 1000;
	const maxTimestamp = points.reduce((max, point) => Math.max(max, point.timestamp), 0);
	const anchor = maxTimestamp > 0 ? maxTimestamp : Math.floor(Date.now() / dayMs) * dayMs;
	const start = anchor - (days - 1) * dayMs;
	const buckets = Array.from({ length: days }, (_, index) => start + index * dayMs);
	const bucketIndex = new Map(buckets.map((timestamp, index) => [timestamp, index]));
	const seriesByKey = new Map<string, ModelPerformanceSeries>();

	for (const point of points) {
		const key = `${point.model}::${point.provider}`;
		let series = seriesByKey.get(key);
		if (!series) {
			series = {
				label: `${point.model} (${point.provider})`,
				data: buckets.map(timestamp => ({
					timestamp,
					avgTtftSeconds: null,
					avgTokensPerSecond: null,
					requests: 0,
				})),
			};
			seriesByKey.set(key, series);
		}

		const index = bucketIndex.get(point.timestamp);
		if (index === undefined) continue;

		series.data[index] = {
			timestamp: point.timestamp,
			avgTtftSeconds: point.avgTtft !== null ? point.avgTtft / 1000 : null,
			avgTokensPerSecond: point.avgTokensPerSecond,
			requests: point.requests,
		};
	}

	return seriesByKey;
}
