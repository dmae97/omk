//! macOS appearance detection via CoreFoundation.
//!
//! Provides synchronous dark/light detection and a long-lived observer
//! that fires a JS callback on system appearance changes.
//!
//! Uses raw CoreFoundation FFI — no `ObjC` runtime, no compiled helpers,
//! no shelling out to `defaults`.
//!
//! # Platform
//! - **macOS**: Full implementation via `CFPreferencesCopyAppValue` +
//!   `CFNotificationCenterGetDistributedCenter`
//! - **Other**: Returns `None` / no-op

use napi_derive::napi;

// ---------------------------------------------------------------------------
// macOS implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod platform {
	use std::{
		ffi::{CStr, CString, c_char, c_void},
		ptr,
		sync::{Arc, Mutex, mpsc},
		thread::{self, JoinHandle},
	};

	use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

	// -- CoreFoundation FFI types -------------------------------------------

	type CFStringRef = *const c_void;
	type CFTypeRef = *const c_void;
	type CFNotificationCenterRef = *const c_void;
	type CFRunLoopRef = *const c_void;
	type CFRunLoopTimerRef = *const c_void;
	type CFIndex = isize;

	const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
	const CF_NOTIFICATION_SUSPEND_DELIVERY: isize = 4;

	/// Layout matches `CFRunLoopTimerContext` from CoreFoundation.
	#[repr(C)]
	struct TimerContext {
		version:          CFIndex,
		info:             *mut c_void,
		retain:           *const c_void,
		release:          *const c_void,
		copy_description: *const c_void,
	}

	#[link(name = "CoreFoundation", kind = "framework")]
	unsafe extern "C" {
		static kCFPreferencesAnyApplication: CFStringRef;
		static kCFRunLoopDefaultMode: CFStringRef;

		fn CFPreferencesCopyAppValue(key: CFStringRef, app: CFStringRef) -> CFTypeRef;
		fn CFStringCreateWithCString(
			alloc: *const c_void,
			c_str: *const c_char,
			encoding: u32,
		) -> CFStringRef;
		fn CFStringGetCStringPtr(s: CFStringRef, encoding: u32) -> *const c_char;
		fn CFStringGetCString(
			s: CFStringRef,
			buf: *mut c_char,
			buf_size: CFIndex,
			encoding: u32,
		) -> bool;
		fn CFRelease(cf: CFTypeRef);
		fn CFGetTypeID(cf: CFTypeRef) -> u64;
		fn CFStringGetTypeID() -> u64;

		fn CFNotificationCenterGetDistributedCenter() -> CFNotificationCenterRef;
		fn CFNotificationCenterAddObserver(
			center: CFNotificationCenterRef,
			observer: *const c_void,
			callback: unsafe extern "C" fn(
				CFNotificationCenterRef,
				*const c_void,
				CFStringRef,
				*const c_void,
				*const c_void,
			),
			name: CFStringRef,
			object: *const c_void,
			suspension_behavior: isize,
		);
		fn CFNotificationCenterRemoveEveryObserver(
			center: CFNotificationCenterRef,
			observer: *const c_void,
		);

		fn CFRunLoopGetCurrent() -> CFRunLoopRef;
		fn CFRunLoopRun();
		fn CFRunLoopStop(rl: CFRunLoopRef);

		fn CFAbsoluteTimeGetCurrent() -> f64;
		fn CFRunLoopTimerCreate(
			allocator: *const c_void,
			fire_date: f64,
			interval: f64,
			flags: u64,
			order: CFIndex,
			callout: unsafe extern "C" fn(CFRunLoopTimerRef, *mut c_void),
			context: *const TimerContext,
		) -> CFRunLoopTimerRef;
		fn CFRunLoopAddTimer(rl: CFRunLoopRef, timer: CFRunLoopTimerRef, mode: CFStringRef);
		fn CFRunLoopTimerInvalidate(timer: CFRunLoopTimerRef);
	}

	// Link Foundation — the distributed notification center's Mach-port
	// plumbing lives here, not in CoreFoundation.
	#[link(name = "Foundation", kind = "framework")]
	unsafe extern "C" {}

	// -- CoreFoundation helpers ---------------------------------------------

	fn create_cf_string(s: &str) -> CFStringRef {
		let Ok(c_str) = CString::new(s) else {
			return ptr::null();
		};
		// SAFETY: `c_str` is a valid null-terminated C string.
		unsafe { CFStringCreateWithCString(ptr::null(), c_str.as_ptr(), K_CF_STRING_ENCODING_UTF8) }
	}

	fn cf_string_to_string(s: CFStringRef) -> String {
		// SAFETY: `s` is a valid `CFStringRef` from a CoreFoundation API call.
		unsafe {
			let ptr = CFStringGetCStringPtr(s, K_CF_STRING_ENCODING_UTF8);
			if !ptr.is_null() {
				return CStr::from_ptr(ptr).to_string_lossy().into_owned();
			}
			let mut buf = [0u8; 256];
			if CFStringGetCString(s, buf.as_mut_ptr().cast::<c_char>(), 256, K_CF_STRING_ENCODING_UTF8)
			{
				let len = buf.iter().position(|&b| b == 0).unwrap_or(0);
				String::from_utf8_lossy(&buf[..len]).into_owned()
			} else {
				String::new()
			}
		}
	}

	// -- Sync detection -----------------------------------------------------

	/// Read `AppleInterfaceStyle` via CoreFoundation preferences.
	/// Returns `"dark"` or `"light"`.
	pub fn detect_appearance() -> String {
		// SAFETY: CF pointers are null-checked, CF objects are released after use.
		unsafe {
			let key = create_cf_string("AppleInterfaceStyle");
			if key.is_null() {
				return "light".into();
			}

			let value = CFPreferencesCopyAppValue(key, kCFPreferencesAnyApplication);
			CFRelease(key);

			if value.is_null() {
				// Key absent = light mode (no dark mode override set).
				return "light".into();
			}

			if CFGetTypeID(value) != CFStringGetTypeID() {
				CFRelease(value);
				return "light".into();
			}

			let result = cf_string_to_string(value);
			CFRelease(value);
			if result == "Dark" {
				"dark".into()
			} else {
				"light".into()
			}
		}
	}

	// -- Observer -----------------------------------------------------------

	/// Opaque handle to a `CFRunLoop` — `Send + Sync` for cross-thread stop.
	struct SendableRunLoop(CFRunLoopRef);
	// SAFETY: `CFRunLoopStop` is thread-safe per Apple docs.
	unsafe impl Send for SendableRunLoop {}
	// SAFETY: Only used via `CFRunLoopStop` which is documented thread-safe.
	unsafe impl Sync for SendableRunLoop {}

	/// Shared context for the notification callback and the poll timer.
	struct CallbackCtx {
		tsfn: ThreadsafeFunction<String>,
		/// Last reported appearance — used for dedup so we never fire twice
		/// for the same value (notification + timer can race).
		last: Mutex<String>,
	}

	impl CallbackCtx {
		/// Read current appearance; fire JS callback only when it changed.
		fn report_if_changed(&self) {
			let appearance = detect_appearance();
			let mut last = self.last.lock().unwrap();
			if *last != appearance {
				(*last).clone_from(&appearance);
				self
					.tsfn
					.call(Ok(appearance), ThreadsafeFunctionCallMode::NonBlocking);
			}
		}
	}

	/// C notification callback — fired by `CFDistributedNotificationCenter`
	/// when macOS posts `AppleInterfaceThemeChangedNotification`.
	unsafe extern "C" fn on_notification(
		_center: CFNotificationCenterRef,
		observer: *const c_void,
		_name: CFStringRef,
		_object: *const c_void,
		_user_info: *const c_void,
	) {
		// SAFETY: `observer` is a leaked `Box<CallbackCtx>` valid for the
		// observer's entire lifetime (freed after `CFRunLoopRun` returns).
		let ctx = unsafe { &*observer.cast::<CallbackCtx>() };
		ctx.report_if_changed();
	}

	/// Timer callback — polls `CFPreferencesCopyAppValue` as a fallback.
	///
	/// Distributed notifications may not reliably deliver to background
	/// threads on all macOS versions.  This timer (a) keeps the run loop
	/// alive so `CFRunLoopRun` doesn't exit immediately, and (b) guarantees
	/// we detect theme changes within the polling interval even if the
	/// notification path is dead.
	unsafe extern "C" fn on_timer(_timer: CFRunLoopTimerRef, info: *mut c_void) {
		// SAFETY: `info` is the same leaked `Box<CallbackCtx>`.
		let ctx = unsafe { &*(info as *const CallbackCtx) };
		ctx.report_if_changed();
	}

	/// Polling interval in seconds for the fallback timer.
	const POLL_INTERVAL_SECS: f64 = 2.0;

	/// Internal state for a running observer.
	pub struct ObserverInner {
		run_loop: Arc<Mutex<Option<SendableRunLoop>>>,
		thread:   Option<JoinHandle<()>>,
	}

	impl ObserverInner {
		pub fn start(tsfn: ThreadsafeFunction<String>) -> Self {
			let run_loop: Arc<Mutex<Option<SendableRunLoop>>> = Arc::new(Mutex::new(None));
			let rl_clone = run_loop.clone();

			// Signal that the background thread has stored its `CFRunLoopRef`.
			let (tx, rx) = mpsc::sync_channel::<()>(1);

			let handle = thread::spawn(move || {
				// SAFETY: All CF calls are correctly paired (create/release,
				// add/remove). The `ctx_ptr` is leaked via `Box::into_raw` and
				// reclaimed via `Box::from_raw` after the run loop exits.
				unsafe {
					let rl = CFRunLoopGetCurrent();
					*rl_clone.lock().unwrap() = Some(SendableRunLoop(rl));
					let _ = tx.send(());

					let ctx = Box::new(CallbackCtx { tsfn, last: Mutex::new(String::new()) });
					let ctx_ptr = Box::into_raw(ctx);

					// -- Register for distributed notification ---------------
					let center = CFNotificationCenterGetDistributedCenter();
					let name = create_cf_string("AppleInterfaceThemeChangedNotification");

					CFNotificationCenterAddObserver(
						center,
						ctx_ptr.cast(),
						on_notification,
						name,
						ptr::null(),
						CF_NOTIFICATION_SUSPEND_DELIVERY,
					);

					if !name.is_null() {
						CFRelease(name);
					}

					// -- Polling timer (keep-alive + fallback) ---------------
					//
					// Two purposes:
					// 1. Keeps `CFRunLoopRun` alive — without any source/timer attached,
					//    `CFRunLoopRun` returns immediately.
					// 2. Polls `CFPreferencesCopyAppValue` every 2 s so we catch theme changes even
					//    if the Mach-port notification doesn't fire on this thread.
					let timer_ctx = TimerContext {
						version:          0,
						info:             ctx_ptr.cast::<c_void>(),
						retain:           ptr::null(),
						release:          ptr::null(),
						copy_description: ptr::null(),
					};
					let timer = CFRunLoopTimerCreate(
						ptr::null(),
						CFAbsoluteTimeGetCurrent() + POLL_INTERVAL_SECS,
						POLL_INTERVAL_SECS,
						0,
						0,
						on_timer,
						&raw const timer_ctx,
					);
					CFRunLoopAddTimer(rl, timer, kCFRunLoopDefaultMode);

					// Report initial appearance immediately.
					(*ctx_ptr).report_if_changed();

					// Block until `CFRunLoopStop()` is called from `stop()`.
					CFRunLoopRun();

					// -- Cleanup ---------------------------------------------
					CFRunLoopTimerInvalidate(timer);
					CFRelease(timer);
					CFNotificationCenterRemoveEveryObserver(center, ctx_ptr.cast());
					drop(Box::from_raw(ctx_ptr));
				}
			});

			// Wait until run loop ref is stored so `stop()` is always safe.
			let _ = rx.recv();

			Self { run_loop, thread: Some(handle) }
		}

		pub fn stop(&mut self) {
			let rl = self.run_loop.lock().unwrap().take();
			if let Some(rl) = rl {
				// SAFETY: `CFRunLoopStop` is thread-safe per Apple docs.
				unsafe {
					CFRunLoopStop(rl.0);
				}
			}
			if let Some(t) = self.thread.take() {
				let _ = t.join();
			}
		}
	}

	impl Drop for ObserverInner {
		fn drop(&mut self) {
			self.stop();
		}
	}
}

// ---------------------------------------------------------------------------
// N-API exports
// ---------------------------------------------------------------------------

/// Detect macOS system appearance via CoreFoundation.
/// Returns `"dark"` or `"light"` on macOS, `null` on other platforms.
#[napi(js_name = "detectMacOSAppearance")]
#[allow(clippy::missing_const_for_fn, reason = "napi macro is incompatible with const fn")]
pub fn detect_macos_appearance() -> Option<String> {
	#[cfg(target_os = "macos")]
	{
		Some(platform::detect_appearance())
	}
	#[cfg(not(target_os = "macos"))]
	{
		None
	}
}

/// Long-lived macOS appearance observer.
///
/// Subscribes to `AppleInterfaceThemeChangedNotification` via
/// `CFDistributedNotificationCenter` and calls the provided callback
/// with `"dark"` or `"light"` on each change (and once on start).
///
/// A 2-second polling timer also runs as fallback — distributed
/// notifications may not reliably reach background threads on all
/// macOS versions.
///
/// On non-macOS platforms, `start()` returns a no-op observer.
#[napi]
pub struct MacAppearanceObserver {
	#[cfg(target_os = "macos")]
	inner: Option<platform::ObserverInner>,
}

#[napi]
impl MacAppearanceObserver {
	#[napi(factory)]
	pub fn start(
		#[napi(ts_arg_type = "(err: null | Error, appearance: string) => void")]
		callback: napi::threadsafe_function::ThreadsafeFunction<String>,
	) -> napi::Result<Self> {
		#[cfg(target_os = "macos")]
		{
			Ok(Self { inner: Some(platform::ObserverInner::start(callback)) })
		}
		#[cfg(not(target_os = "macos"))]
		{
			drop(callback);
			Ok(Self {})
		}
	}

	#[napi]
	#[allow(clippy::missing_const_for_fn, reason = "napi macro is incompatible with const fn")]
	pub fn stop(&mut self) {
		#[cfg(target_os = "macos")]
		if let Some(ref mut inner) = self.inner {
			inner.stop();
		}
	}
}
