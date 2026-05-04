import { registerImagesApiProvider } from "../images-api-registry.js";
import type {
	AssistantImages,
	AssistantImagesEvent,
	ImagesContext,
	ImagesFunction,
	ImagesModel,
	ImagesOptions,
} from "../types.js";
import { AssistantImagesEventStream } from "../utils/event-stream.js";
import type { imagesOpenRouter as imagesOpenRouterFunction } from "./openrouter-images.js";

interface OpenRouterImagesProviderModule {
	imagesOpenRouter: typeof imagesOpenRouterFunction;
}

let openRouterImagesProviderModulePromise: Promise<OpenRouterImagesProviderModule> | undefined;

function forwardImagesStream(target: AssistantImagesEventStream, source: AsyncIterable<AssistantImagesEvent>): void {
	(async () => {
		for await (const event of source) {
			target.push(event);
		}
		target.end();
	})();
}

function createLazyLoadErrorImages(model: ImagesModel<"openrouter-images">, error: unknown): AssistantImages {
	return {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

function loadOpenRouterImagesProviderModule(): Promise<OpenRouterImagesProviderModule> {
	openRouterImagesProviderModulePromise ||= import("./openrouter-images.js").then(
		(module) => module as OpenRouterImagesProviderModule,
	);
	return openRouterImagesProviderModulePromise;
}

export const imagesOpenRouter: ImagesFunction<"openrouter-images", ImagesOptions> = (
	model: ImagesModel<"openrouter-images">,
	context: ImagesContext,
	options?: ImagesOptions,
) => {
	const outer = new AssistantImagesEventStream();

	loadOpenRouterImagesProviderModule()
		.then((module) => {
			const inner = module.imagesOpenRouter(model, context, options);
			forwardImagesStream(outer, inner);
		})
		.catch((error) => {
			const images = createLazyLoadErrorImages(model, error);
			outer.push({ type: "error", reason: "error", error: images });
			outer.end(images);
		});

	return outer;
};

export function registerBuiltInImagesApiProviders(): void {
	registerImagesApiProvider({
		api: "openrouter-images",
		images: imagesOpenRouter,
	});
}

registerBuiltInImagesApiProviders();
