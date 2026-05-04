import type {
	AssistantImagesEventStream,
	ImagesApi,
	ImagesContext,
	ImagesFunction,
	ImagesModel,
	ImagesOptions,
} from "./types.js";

export type ImagesApiFunction = (
	model: ImagesModel<ImagesApi>,
	context: ImagesContext,
	options?: ImagesOptions,
) => AssistantImagesEventStream;

export interface ImagesApiProvider<TApi extends ImagesApi = ImagesApi, TOptions extends ImagesOptions = ImagesOptions> {
	api: TApi;
	images: ImagesFunction<TApi, TOptions>;
}

interface ImagesApiProviderInternal {
	api: ImagesApi;
	images: ImagesApiFunction;
}

type RegisteredImagesApiProvider = {
	provider: ImagesApiProviderInternal;
	sourceId?: string;
};

const imagesApiProviderRegistry = new Map<string, RegisteredImagesApiProvider>();

function wrapImages<TApi extends ImagesApi, TOptions extends ImagesOptions>(
	api: TApi,
	images: ImagesFunction<TApi, TOptions>,
): ImagesApiFunction {
	return (model, context, options) => {
		if (model.api !== api) {
			throw new Error(`Mismatched api: ${model.api} expected ${api}`);
		}
		return images(model as ImagesModel<TApi>, context, options as TOptions);
	};
}

export function registerImagesApiProvider<TApi extends ImagesApi, TOptions extends ImagesOptions>(
	provider: ImagesApiProvider<TApi, TOptions>,
	sourceId?: string,
): void {
	imagesApiProviderRegistry.set(provider.api, {
		provider: {
			api: provider.api,
			images: wrapImages(provider.api, provider.images),
		},
		sourceId,
	});
}

export function getImagesApiProvider(api: ImagesApi): ImagesApiProviderInternal | undefined {
	return imagesApiProviderRegistry.get(api)?.provider;
}
