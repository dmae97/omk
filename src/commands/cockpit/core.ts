/**
 * OMK Chat Cockpit — main command entrypoint.
 */

import { normalizeRefreshMs, type CockpitCommandOptions, type CockpitCache } from "./utils.js";
import { renderCockpit } from "./render.js";
import { CockpitRenderer } from "./update-loop.js";

export async function cockpitCommand(options: CockpitCommandOptions = {}): Promise<void> {
  const refreshMs = normalizeRefreshMs(options.refreshMs);

  if (!options.watch) {
    console.log(await renderCockpit({ runId: options.runId, height: options.height, section: options.section, events: options.events, view: options.view }));
    return;
  }

  const renderer = new CockpitRenderer(refreshMs, options.height);
  if (options.redraw) {
    renderer.mode = options.redraw;
  }
  const cache: CockpitCache = {};

  const stop = (): void => {
    renderer.stopped = true;
  };
  const onResize = (): void => {
    renderer.resized = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.on("SIGWINCH", onResize);

  renderer.setupKeyboard();

  try {
    // First paint: render immediately from local state without waiting for slow ops
    let firstPaint = true;

    while (!renderer.stopped) {
      const frame = await renderCockpit({
        runId: options.runId,
        terminalWidth: process.stdout.columns,
        cache,
        quick: firstPaint,
        showHistory: renderer.showHistory,
        height: renderer.height,
        animFrame: renderer.getAnimFrame(),
        section: options.section,
        events: options.events,
        view: options.view,
        renderer,
      });

      if (firstPaint) {
        // Full clear on first paint so subsequent diff frames have a known baseline
        const savedMode = renderer.mode;
        renderer.mode = "full";
        renderer.render(frame);
        renderer.mode = savedMode;
        firstPaint = false;
      } else {
        renderer.render(frame);
      }

      if (renderer.stopped) break;

      // Wait for refresh interval or resize/refresh event
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, renderer.refreshMs);
        const interval = setInterval(() => {
          if (renderer.stopped || renderer.resized) {
            clearTimeout(timer);
            clearInterval(interval);
            renderer.resized = false;
            resolve();
          }
        }, 100);
      });

      // When paused, skip timer-based re-renders but keep listening for keys
      while (renderer.paused && !renderer.stopped && !renderer.resized) {
        await new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (renderer.stopped || renderer.resized) {
              clearInterval(interval);
              renderer.resized = false;
              resolve();
            }
          }, 100);
        });
      }
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.off("SIGWINCH", onResize);
    renderer.teardown();
  }

  process.stdout.write("\n");
}
