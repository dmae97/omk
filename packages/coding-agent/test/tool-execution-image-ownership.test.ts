import { resetCapabilitiesCache, setCapabilities, type TUI } from "omk-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatContainer } from "../src/modes/interactive/components/chat-container.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { ToolExecutionImages } from "../src/modes/interactive/components/tool-execution-images.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { convertToPng } from "../src/utils/image-convert.ts";

vi.mock("../src/utils/image-convert.ts", () => ({ convertToPng: vi.fn() }));

const png = (value: string) => ({ data: Buffer.from(value).toString("base64"), mimeType: "image/png" });
const image = (data: string, mimeType = "image/jpeg") => ({ type: "image", data, mimeType });
const result = (...images: ReturnType<typeof image>[]) => ({ content: images, isError: false });
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const settle = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(showImages = true) {
	const requestRender = vi.fn();
	const component = new ToolExecutionComponent(
		"custom",
		"image-call",
		{},
		{ showImages },
		undefined,
		{ requestRender } as unknown as TUI,
		process.cwd(),
	);
	return { component, requestRender, output: () => component.render(60).join("\n") };
}

beforeEach(() => {
	initTheme("dark");
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	vi.mocked(convertToPng).mockReset();
});
afterEach(() => resetCapabilitiesCache());

describe("tool image conversion ownership", () => {
	it("shares one active conversion across repeated and duplicate image results", async () => {
		const gate = deferred<Awaited<ReturnType<typeof convertToPng>>>();
		vi.mocked(convertToPng).mockReturnValue(gate.promise);
		const { component, output } = fixture();
		for (let i = 0; i < 10; i++) component.updateResult(result(image("a"), image("a")));
		expect(convertToPng).toHaveBeenCalledTimes(1);
		gate.resolve(png("converted-a"));
		await settle();
		expect(output()).toContain(png("converted-a").data);
		component.updateResult(result(image("a")));
		expect(convertToPng).toHaveBeenCalledTimes(1);
	});

	it("does not publish an old completion at a reused image index", async () => {
		const old = deferred<Awaited<ReturnType<typeof convertToPng>>>();
		const current = deferred<Awaited<ReturnType<typeof convertToPng>>>();
		vi.mocked(convertToPng).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
		const { component, output, requestRender } = fixture();
		component.updateResult(result(image("old")));
		component.updateResult(result(image("current")));
		old.resolve(png("old-png"));
		await settle();
		expect(requestRender).not.toHaveBeenCalled();
		expect(output()).not.toContain(png("old-png").data);
		current.resolve(png("current-png"));
		await settle();
		expect(output()).toContain(png("current-png").data);
		expect(output()).not.toContain(png("old-png").data);
	});

	it("keeps conversion identity when images swap or source objects mutate in place", async () => {
		const a = deferred<Awaited<ReturnType<typeof convertToPng>>>();
		const b = deferred<Awaited<ReturnType<typeof convertToPng>>>();
		vi.mocked(convertToPng).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
		const { component, output } = fixture();
		const mutable = result(image("a"), image("b"));
		component.updateResult(mutable);
		mutable.content.reverse();
		component.updateResult(mutable);
		expect(convertToPng).toHaveBeenCalledTimes(2);
		a.resolve(png("first"));
		b.resolve(png("second"));
		await settle();
		expect(output().indexOf(png("second").data)).toBeLessThan(output().indexOf(png("first").data));
		mutable.content[0].mimeType = "image/png";
		mutable.content[0].data = png("replacement").data;
		component.updateResult(mutable);
		expect(output()).toContain(png("replacement").data);
		expect(output()).not.toContain(png("second").data);
	});

	it("bypasses PNG and defers hidden conversions until shown", async () => {
		vi.mocked(convertToPng).mockResolvedValue(png("converted"));
		const { component, output } = fixture(false);
		component.updateResult(result(image("jpeg")));
		expect(convertToPng).not.toHaveBeenCalled();
		component.setShowImages(true);
		await settle();
		expect(convertToPng).toHaveBeenCalledTimes(1);
		expect(output()).toContain(png("converted").data);
		component.updateResult(result(image(png("original").data, "image/png")));
		expect(convertToPng).toHaveBeenCalledTimes(1);
		expect(output()).toContain(png("original").data);
	});

	it.each(["null", "reject"] as const)(
		"preserves the original after %s failure and retries only on result update",
		async (failure) => {
			if (failure === "null") vi.mocked(convertToPng).mockResolvedValueOnce(null);
			else vi.mocked(convertToPng).mockRejectedValueOnce(new Error("decoder failure"));
			const original = result(image("original-jpeg"));
			const { component, output } = fixture();
			component.updateResult(original);
			await settle();
			expect(output()).toContain("Image conversion unavailable");
			component.setExpanded(true);
			component.setImageWidthCells(30);
			component.invalidate();
			expect(convertToPng).toHaveBeenCalledTimes(1);
			expect(original.content[0].data).toBe("original-jpeg");
			vi.mocked(convertToPng).mockResolvedValueOnce(png("retry"));
			component.updateResult(original);
			await settle();
			expect(convertToPng).toHaveBeenCalledTimes(2);
			expect(output()).toContain(png("retry").data);
		},
	);

	it("owns active promises until settlement even after the view is disposed", async () => {
		const gate = deferred<Awaited<ReturnType<typeof convertToPng>>>();
		vi.mocked(convertToPng).mockReturnValue(gate.promise);
		const changed = vi.fn();
		const images = new ToolExecutionImages(changed);
		images.setResult(result(image("pending")).content);
		expect(images.pendingCount).toBe(1);
		images.dispose();
		expect(images.pendingCount).toBe(1);
		gate.resolve(png("late"));
		await images.whenSettled();
		expect(images.pendingCount).toBe(0);
		expect(changed).not.toHaveBeenCalled();
		expect(images.render(60)).toEqual([]);
	});

	it("retires conversion callbacks when chat history is cleared", async () => {
		const gate = deferred<Awaited<ReturnType<typeof convertToPng>>>();
		vi.mocked(convertToPng).mockReturnValue(gate.promise);
		const { component, requestRender } = fixture();
		const chat = new ChatContainer();
		chat.addChild(component);
		component.updateResult(result(image("pending")));
		chat.clear();
		gate.resolve(png("late"));
		await settle();
		expect(chat.children).toHaveLength(0);
		expect(component.render(60)).toEqual([]);
		expect(requestRender).not.toHaveBeenCalled();
	});

	it("never schedules a repaint or new conversion after disposal", async () => {
		const gate = deferred<Awaited<ReturnType<typeof convertToPng>>>();
		vi.mocked(convertToPng).mockReturnValue(gate.promise);
		const { component, requestRender } = fixture();
		component.updateResult(result(image("pending")));
		component.dispose();
		gate.resolve(png("late"));
		await settle();
		component.updateResult(result(image("new")));
		expect(requestRender).not.toHaveBeenCalled();
		expect(convertToPng).toHaveBeenCalledTimes(1);
	});
});
