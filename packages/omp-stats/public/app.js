// Format helpers
function formatNumber(n) {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toFixed(0);
}

function formatCost(n) {
	if (n < 0.01) return `$${n.toFixed(4)}`;
	if (n < 1) return `$${n.toFixed(3)}`;
	return `$${n.toFixed(2)}`;
}

function formatDuration(ms) {
	if (ms === null || ms === undefined) return '-';
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatPercent(n) {
	return `${(n * 100).toFixed(1)}%`;
}

function formatTime(timestamp) {
	return new Date(timestamp).toLocaleTimeString();
}

// Chart instance
let timeSeriesChart = null;

// Update dashboard with stats
function updateDashboard(stats) {
	const { overall, byModel, byFolder, timeSeries } = stats;

	// Overall stats
	document.getElementById('totalRequests').textContent = formatNumber(overall.totalRequests);
	document.getElementById('requestDetails').textContent = 
		`${formatNumber(overall.successfulRequests)} success, ${formatNumber(overall.failedRequests)} errors`;

	document.getElementById('totalCost').textContent = formatCost(overall.totalCost);
	document.getElementById('avgCostPerRequest').textContent = 
		overall.totalRequests > 0 ? `${formatCost(overall.totalCost / overall.totalRequests)} avg/req` : '-';

	document.getElementById('cacheRate').textContent = formatPercent(overall.cacheRate);
	document.getElementById('cacheDetails').textContent = 
		`${formatNumber(overall.totalCacheReadTokens)} cached tokens`;

	document.getElementById('errorRate').textContent = formatPercent(overall.errorRate);
	document.getElementById('errorDetails').textContent = 
		`${formatNumber(overall.failedRequests)} failed requests`;

	document.getElementById('avgDuration').textContent = formatDuration(overall.avgDuration);
	document.getElementById('ttftDetail').textContent = 
		overall.avgTtft !== null ? `TTFT: ${formatDuration(overall.avgTtft)}` : '-';

	document.getElementById('tokensPerSecond').textContent = 
		overall.avgTokensPerSecond !== null ? overall.avgTokensPerSecond.toFixed(1) : '-';
	document.getElementById('totalTokens').textContent = 
		`${formatNumber(overall.totalInputTokens + overall.totalOutputTokens)} total tokens`;

	// Model table
	const modelBody = document.querySelector('#modelTable tbody');
	modelBody.innerHTML = byModel.slice(0, 20).map(m => `
		<tr>
			<td>${m.model}</td>
			<td>${m.provider}</td>
			<td>${formatNumber(m.totalRequests)}</td>
			<td>${formatCost(m.totalCost)}</td>
			<td>${formatPercent(m.cacheRate)}</td>
			<td>${m.avgTokensPerSecond !== null ? m.avgTokensPerSecond.toFixed(1) : '-'}</td>
		</tr>
	`).join('');

	// Folder table
	const folderBody = document.querySelector('#folderTable tbody');
	folderBody.innerHTML = byFolder.slice(0, 20).map(f => `
		<tr>
			<td>${f.folder}</td>
			<td>${formatNumber(f.totalRequests)}</td>
			<td>${formatCost(f.totalCost)}</td>
			<td class="${f.errorRate > 0.1 ? 'error-text' : ''}">${formatPercent(f.errorRate)}</td>
		</tr>
	`).join('');

	// Time series chart
	updateChart(timeSeries);

	// Update last sync time
	document.getElementById('lastSync').textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

function updateChart(timeSeries) {
	const ctx = document.getElementById('timeSeriesChart').getContext('2d');

	const labels = timeSeries.map(p => formatTime(p.timestamp));
	const requests = timeSeries.map(p => p.requests);
	const errors = timeSeries.map(p => p.errors);

	if (timeSeriesChart) {
		timeSeriesChart.data.labels = labels;
		timeSeriesChart.data.datasets[0].data = requests;
		timeSeriesChart.data.datasets[1].data = errors;
		timeSeriesChart.update();
		return;
	}

	timeSeriesChart = new Chart(ctx, {
		type: 'line',
		data: {
			labels,
			datasets: [
				{
					label: 'Requests',
					data: requests,
					borderColor: '#4ade80',
					backgroundColor: 'rgba(74, 222, 128, 0.1)',
					fill: true,
					tension: 0.4,
				},
				{
					label: 'Errors',
					data: errors,
					borderColor: '#f87171',
					backgroundColor: 'rgba(248, 113, 113, 0.1)',
					fill: true,
					tension: 0.4,
				}
			]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: {
					labels: { color: '#aaa' }
				}
			},
			scales: {
				x: {
					ticks: { color: '#aaa' },
					grid: { color: 'rgba(255,255,255,0.1)' }
				},
				y: {
					ticks: { color: '#aaa' },
					grid: { color: 'rgba(255,255,255,0.1)' }
				}
			}
		}
	});
}

// Fetch and update stats
async function refresh() {
	try {
		const response = await fetch('/api/stats');
		const stats = await response.json();
		updateDashboard(stats);
	} catch (error) {
		console.error('Failed to fetch stats:', error);
		document.getElementById('lastSync').textContent = `Error: ${error.message}`;
	}
}

// Auto-refresh every 30 seconds
setInterval(refresh, 30000);

// Initial load
refresh();
