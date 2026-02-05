import { initTheme } from "../src/modes/theme/theme";
import { truncateToVisualLines } from "../src/modes/components/visual-truncate";
import { WelcomeComponent } from "../src/modes/components/welcome";

const ITERATIONS = 500;
const WIDTH = 100;

const longText = Array.from({ length: 200 })
	.map((_, i) => `Line ${i + 1}: \x1b[32mcolored content\x1b[0m with emojis 🚀✨ and extra padding`)
	.join("\n");

function bench(name: string, fn: () => void): number {
	const start = Bun.nanoseconds();
	for (let i = 0; i < ITERATIONS; i++) {
		fn();
	}
	const elapsed = (Bun.nanoseconds() - start) / 1e6;
	const perOp = (elapsed / ITERATIONS).toFixed(6);
	console.log(`${name}: ${elapsed.toFixed(2)}ms total (${perOp}ms/op)`);
	return elapsed;
}

await initTheme("dark");

console.log(`Rendering benchmark (${ITERATIONS} iterations)\n`);

bench("truncateToVisualLines", () => {
	truncateToVisualLines(longText, 20, WIDTH, 1);
});

const welcome = new WelcomeComponent("8.12.3", "claude-3.7", "anthropic",	[
	{ name: "Test session", timeAgo: "2m" },
	{ name: "Another session", timeAgo: "1h" },
], [
	{ name: "tsserver", status: "ready", fileTypes: ["ts", "tsx", "js"] },
	{ name: "rust-analyzer", status: "connecting", fileTypes: ["rs"] },
]);

bench("WelcomeComponent.render", () => {
	welcome.render(WIDTH);
});
