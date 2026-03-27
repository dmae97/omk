//! Shared native search DB state for grep/glob/fuzzyFind.
//!
//! This owns search-side shared state that should outlive individual native
//! calls: frecency tracking plus a per-root cache of `fff` file pickers.

use std::{
	collections::HashMap,
	path::Path,
	sync::{Arc, atomic::Ordering},
	time::Duration,
};

use fff::{FFFMode, FileItem, FilePicker, FrecencyTracker, SharedFrecency, SharedPicker};
use napi::{Error, bindgen_prelude::Result};
use napi_derive::napi;
use parking_lot::Mutex;

use crate::task;

struct SearchDbInner {
	path:            String,
	shared_frecency: SharedFrecency,
	pickers:         Mutex<HashMap<String, SharedPicker>>,
}

impl Drop for SearchDbInner {
	fn drop(&mut self) {
		for shared_picker in self.pickers.lock().values() {
			let Ok(mut guard) = shared_picker.write() else {
				continue;
			};
			if let Some(picker) = guard.as_mut() {
				picker.cancel();
				picker.stop_background_monitor();
			}
		}
	}
}

#[derive(Clone)]
#[napi]
pub struct SearchDb {
	inner: Arc<SearchDbInner>,
}

#[napi]
impl SearchDb {
	#[napi(constructor)]
	pub fn new(path: String) -> Self {
		let normalized = path.trim().to_string();
		let shared_frecency: SharedFrecency = Default::default();

		if !normalized.is_empty()
			&& let Ok(tracker) = FrecencyTracker::new(&normalized, false)
		{
			if let Ok(mut guard) = shared_frecency.write() {
				*guard = Some(tracker);
			}
			let _ = FrecencyTracker::spawn_gc(Arc::clone(&shared_frecency), normalized.clone(), false);
		}

		Self {
			inner: Arc::new(SearchDbInner {
				path: normalized,
				shared_frecency,
				pickers: Mutex::new(HashMap::new()),
			}),
		}
	}

	#[napi(getter)]
	pub fn path(&self) -> String {
		self.inner.path.clone()
	}
}

impl SearchDb {
	fn picker_key(root: &Path) -> String {
		root
			.canonicalize()
			.unwrap_or_else(|_| root.to_path_buf())
			.to_string_lossy()
			.into_owned()
	}

	pub fn get_or_init_picker(&self, root: &Path) -> Result<SharedPicker> {
		let key = Self::picker_key(root);
		let mut pickers = self.inner.pickers.lock();
		if let Some(shared_picker) = pickers.get(&key) {
			return Ok(Arc::clone(shared_picker));
		}

		let shared_picker: SharedPicker = Default::default();
		FilePicker::new_with_shared_state(
			key.clone(),
			false,
			FFFMode::Ai,
			Arc::clone(&shared_picker),
			Arc::clone(&self.inner.shared_frecency),
		)
		.map_err(|err| Error::from_reason(format!("Failed to init file picker: {err}")))?;
		pickers.insert(key, Arc::clone(&shared_picker));
		Ok(shared_picker)
	}

	pub fn update_frecency_scores(&self, item: &mut FileItem) {
		let Ok(guard) = self.inner.shared_frecency.read() else {
			return;
		};
		let Some(tracker) = guard.as_ref() else {
			return;
		};
		let _ = item.update_frecency_scores(tracker, FFFMode::Ai);
	}
}

pub fn wait_for_picker_scan(shared_picker: &SharedPicker, ct: &task::CancelToken) -> Result<()> {
	let signal = {
		let guard = shared_picker
			.read()
			.map_err(|_| Error::from_reason("shared picker lock poisoned"))?;
		let Some(picker) = guard.as_ref() else {
			return Ok(());
		};
		picker.scan_signal()
	};

	while signal.load(Ordering::Acquire) {
		ct.heartbeat()?;
		std::thread::sleep(Duration::from_millis(10));
	}

	ct.heartbeat()?;
	Ok(())
}
