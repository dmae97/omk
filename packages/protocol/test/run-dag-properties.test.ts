import { describe, expect, it } from "vitest";
import { orderRunDag, type RunDagTask, runDagAncestors } from "../src/index.ts";

describe("bounded DAG ordering and dependency closure", () => {
	it("preserves precedence and exactly the reachable ancestors for every five-node ordered DAG", () => {
		// Enumerate all 2^10 edge subsets; Floyd-Warshall is independent of the production Kahn traversal.
		for (let mask = 0; mask < 1024; mask++) {
			const reach = Array.from({ length: 5 }, () => Array<boolean>(5).fill(false));
			let bit = 0;
			for (let from = 0; from < 5; from++)
				for (let to = from + 1; to < 5; to++) reach[from][to] = Boolean(mask & (1 << bit++));
			const tasks: RunDagTask[] = Array.from({ length: 5 }, (_, to) => ({
				id: `t${to}`,
				dependsOn: reach.flatMap((row, from) => (row[to] ? [`t${from}`] : [])),
				writablePaths: [`t${to}`],
				attempts: [["/bin/true"]],
			})).reverse();
			const order = orderRunDag(tasks).map((task) => task.id);
			expect([...order].sort()).toEqual(["t0", "t1", "t2", "t3", "t4"]);
			for (const task of tasks)
				for (const dependency of task.dependsOn)
					expect(order.indexOf(dependency)).toBeLessThan(order.indexOf(task.id));
			for (let mid = 0; mid < 5; mid++)
				for (let from = 0; from < 5; from++)
					for (let to = 0; to < 5; to++) reach[from][to] ||= reach[from][mid] && reach[mid][to];
			for (let to = 0; to < 5; to++) {
				const expected = reach.flatMap((row, from) => (row[to] ? [`t${from}`] : []));
				expect(
					runDagAncestors(tasks, `t${to}`)
						.map((task) => task.id)
						.sort(),
				).toEqual(expected);
			}
			expect(orderRunDag(tasks).map((task) => task.id)).toEqual(order);
		}
	});
});
