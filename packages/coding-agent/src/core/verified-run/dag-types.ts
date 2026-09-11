interface TaskIdentity {
	readonly taskId: string;
	readonly attempt: number;
	readonly generation: number;
}
export type RunTaskProjection = TaskIdentity &
	(
		| { readonly status: "pending"; readonly inputDigest: null; readonly outputDigest: null; readonly failure: null }
		| {
				readonly status: "running";
				readonly inputDigest: string;
				readonly outputDigest: null;
				readonly failure: null;
		  }
		| {
				readonly status: "succeeded";
				readonly inputDigest: string;
				readonly outputDigest: string;
				readonly failure: null;
		  }
		| {
				readonly status: "failed";
				readonly inputDigest: string;
				readonly outputDigest: null;
				readonly failure: string;
		  }
	);
export type RunTaskCheckpoint = Extract<RunTaskProjection, { status: "succeeded" }>;
export type DagEvent =
	| {
			readonly kind: "task_started";
			readonly taskId: string;
			readonly attempt: number;
			readonly inputDigest: string;
			readonly observedMs: number;
	  }
	| {
			readonly kind: "task_finished";
			readonly taskId: string;
			readonly attempt: number;
			readonly outputDigest: string | null;
			readonly failure: string | null;
			readonly observedMs: number;
	  }
	| { readonly kind: "tasks_paused" };
