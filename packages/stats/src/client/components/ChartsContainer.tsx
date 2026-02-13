import {
	CategoryScale,
	Chart as ChartJS,
	Filler,
	Legend,
	LinearScale,
	LineElement,
	PointElement,
	Title,
	Tooltip,
} from "chart.js";
import { format } from "date-fns";
import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import type { ModelTimeSeriesPoint } from "../types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const MODEL_COLORS = [
	"#a78bfa", // violet
	"#22d3ee", // cyan
	"#ec4899", // pink
	"#4ade80", // green
	"#fbbf24", // amber
	"#f87171", // red
	"#60a5fa", // blue
];

interface ChartsContainerProps {
	modelSeries: ModelTimeSeriesPoint[];
}

export function ChartsContainer({ modelSeries }: ChartsContainerProps) {
	const chartData = useMemo(() => buildModelPreferenceSeries(modelSeries), [modelSeries]);

	const data = {
		labels: chartData.data.map(d => format(new Date(d.timestamp), "MMM d")),
		datasets: chartData.series.map((seriesName, index) => ({
			label: seriesName,
			data: chartData.data.map(d => d[seriesName] ?? 0),
			borderColor: MODEL_COLORS[index % MODEL_COLORS.length],
			backgroundColor: `${MODEL_COLORS[index % MODEL_COLORS.length]}20`,
			fill: true,
			tension: 0.4,
			pointRadius: 0,
			pointHoverRadius: 4,
			borderWidth: 2,
		})),
	};

	const options = {
		responsive: true,
		maintainAspectRatio: false,
		interaction: {
			mode: "index" as const,
			intersect: false,
		},
		plugins: {
			legend: {
				position: "top" as const,
				align: "start" as const,
				labels: {
					color: "var(--text-secondary)",
					usePointStyle: true,
					padding: 16,
					font: { size: 12 },
					boxWidth: 8,
				},
			},
			tooltip: {
				backgroundColor: "var(--bg-elevated)",
				titleColor: "var(--text-primary)",
				bodyColor: "var(--text-secondary)",
				borderColor: "var(--border-default)",
				borderWidth: 1,
				padding: 12,
				cornerRadius: 8,
				callbacks: {
					label: (context: { dataset: { label?: string }; parsed: { y: number | null } }) => {
						const label = context.dataset.label ?? "";
						const value = context.parsed.y;
						return `${label}: ${(value ?? 0).toFixed(1)}%`;
					},
				},
			},
		},
		scales: {
			x: {
				grid: {
					color: "var(--border-subtle)",
					drawBorder: false,
				},
				ticks: {
					color: "var(--text-muted)",
					font: { size: 11 },
				},
			},
			y: {
				grid: {
					color: "var(--border-subtle)",
					drawBorder: false,
				},
				ticks: {
					color: "var(--text-muted)",
					font: { size: 11 },
					callback: (value: number | string) => `${value}%`,
				},
				min: 0,
				max: 100,
			},
		},
	};

	return (
		<div className="surface overflow-hidden">
			<div className="px-5 py-4 border-b border-[var(--border-subtle)]">
				<h3 className="text-sm font-semibold text-[var(--text-primary)]">Model Preference</h3>
				<p className="text-xs text-[var(--text-muted)] mt-1">Share of requests over the last 14 days</p>
			</div>
			<div className="p-5 min-h-[320px]">
				{chartData.data.length === 0 ? (
					<div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">
						No data available
					</div>
				) : (
					<div className="h-[280px]">
						<Line data={data} options={options} />
					</div>
				)}
			</div>
		</div>
	);
}

function buildModelPreferenceSeries(
	points: ModelTimeSeriesPoint[],
	topN = 5,
): {
	data: Array<Record<string, number>>;
	series: string[];
} {
	if (points.length === 0) return { data: [], series: [] };

	const totals = new Map<string, { label: string; total: number }>();
	for (const point of points) {
		const key = `${point.model}::${point.provider}`;
		const label = `${point.model} (${point.provider})`;
		const existing = totals.get(key);
		if (existing) {
			existing.total += point.requests;
		} else {
			totals.set(key, { label, total: point.requests });
		}
	}

	const sorted = [...totals.values()].sort((a, b) => b.total - a.total);
	const topLabels = sorted.slice(0, topN).map(entry => entry.label);
	const dataMap = new Map<number, Record<string, number>>();

	for (const point of points) {
		const label = `${point.model} (${point.provider})`;
		const bucket = dataMap.get(point.timestamp) ?? { timestamp: point.timestamp, total: 0 };
		bucket.total += point.requests;
		const key = topLabels.includes(label) ? label : "Other";
		bucket[key] = (bucket[key] ?? 0) + point.requests;
		dataMap.set(point.timestamp, bucket);
	}

	const series = [...topLabels];
	if ([...dataMap.values()].some(row => (row.Other ?? 0) > 0)) {
		series.push("Other");
	}

	const data = [...dataMap.values()]
		.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
		.map(row => {
			const total = row.total ?? 0;
			for (const key of series) {
				row[key] = total > 0 ? ((row[key] ?? 0) / total) * 100 : 0;
			}
			return row;
		});

	return { data, series };
}
