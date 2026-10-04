import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Pi's model registry with no stored credentials, models.json, or network catalog.
 * Providers read their keys from the environment, such as TYPESAFE_API_KEY.
 */
export async function testModels(): Promise<ModelRegistry> {
  return new ModelRegistry(
    await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    }),
  );
}
