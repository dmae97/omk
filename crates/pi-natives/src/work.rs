//! Rayon-backed scheduling for blocking work in N-API exports.
//!
//! # Overview
//! Runs CPU-bound or blocking Rust work on a shared Rayon thread pool instead
//! of Tokio's limited blocking workers.
//!
//! # Example
//! ```ignore
//! use pi_natives::work::launch_task;
//!
//! # async fn demo() -> napi::Result<()> {
//! let handle = launch_task(|| Ok(42));
//! let value = handle.wait().await?;
//! assert_eq!(value, 42);
//! # Ok(())
//! # }
//! ```
//!
//! # Architecture
//! ```text
//! JS async -> N-API -> launch_task -> Rayon thread pool
//! ```

use std::{
	panic::{AssertUnwindSafe, catch_unwind},
	sync::OnceLock,
};

use napi::{Error, Result};
use rayon::{ThreadPool, ThreadPoolBuilder};
use tokio::sync::oneshot;

/// Handle for a scheduled blocking task.
pub struct WorkHandle<T> {
	receiver: oneshot::Receiver<Result<T>>,
}

impl<T> WorkHandle<T> {
	/// Await completion of the scheduled work.
	///
	/// # Errors
	/// Returns an error if the task panics or the channel is cancelled.
	pub async fn wait(self) -> Result<T> {
		match self.receiver.await {
			Ok(result) => result,
			Err(_) => Err(Error::from_reason("Rayon task cancelled")),
		}
	}
}

/// Schedule blocking work on the shared Rayon pool.
///
/// # Errors
/// The returned handle resolves to an error if the task panics or is cancelled.
pub fn launch_task<F, T>(work: F) -> WorkHandle<T>
where
	F: FnOnce() -> Result<T> + Send + 'static,
	T: Send + 'static,
{
	let pool = thread_pool();
	let (sender, receiver) = oneshot::channel();
	pool.spawn(move || {
		let result = catch_unwind(AssertUnwindSafe(work))
			.unwrap_or_else(|_| Err(Error::from_reason("Rayon task panicked")));
		let _ = sender.send(result);
	});
	WorkHandle { receiver }
}

fn thread_pool() -> &'static ThreadPool {
	static POOL: OnceLock<ThreadPool> = OnceLock::new();
	POOL.get_or_init(|| {
		ThreadPoolBuilder::new()
			.thread_name(|index| format!("pi-natives-{}", index))
			.build()
			.expect("Failed to build Rayon thread pool")
	})
}
