import { randomUUID } from "node:crypto";
import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type OAuthProviderInterface,
	registerApiProvider,
	restoreMissingBuiltInApiProviders,
	type SimpleStreamOptions,
	unregisterApiProviders,
} from "omk-ai";
import { registerOAuthProvider, unregisterOAuthProvider } from "omk-ai/oauth";

/**
 * Per-ModelRegistry dynamic API/OAuth provider ownership tracker.
 * Refresh/reload releases only this registry's registrations so sibling sessions
 * in the same process keep their custom providers intact.
 */
export class ModelRegistryProviderOwnership {
	private readonly ownerId = randomUUID();
	private readonly ownedApiSourceIds = new Set<string>();
	private readonly ownedOAuthProviderIds = new Set<string>();

	registerOAuth(providerName: string, oauthProvider: OAuthProviderInterface): void {
		this.ownedOAuthProviderIds.add(providerName);
		registerOAuthProvider(oauthProvider);
	}

	registerStreamSimple(
		providerName: string,
		api: Api,
		streamSimple: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream,
	): void {
		const sourceId = `model-registry:${this.ownerId}:${providerName}`;
		this.ownedApiSourceIds.add(sourceId);
		registerApiProvider(
			{
				api,
				stream: (model, context, options) => streamSimple(model, context, options as SimpleStreamOptions),
				streamSimple,
			},
			sourceId,
		);
	}

	releaseAll(): void {
		for (const sourceId of this.ownedApiSourceIds) {
			unregisterApiProviders(sourceId);
		}
		if (this.ownedApiSourceIds.size > 0) {
			restoreMissingBuiltInApiProviders();
			this.ownedApiSourceIds.clear();
		}
		for (const oauthId of this.ownedOAuthProviderIds) {
			unregisterOAuthProvider(oauthId);
		}
		this.ownedOAuthProviderIds.clear();
	}
}
