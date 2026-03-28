import { createBraveProvider } from "./brave.js";
import { createExaProvider } from "./exa.js";
import { createFirecrawlProvider } from "./firecrawl.js";
import { createJinaProvider } from "./jina.js";
import createSerperProviderFactory from "./serper.js";
import { createTavilyProvider } from "./tavily.js";
import type { InitializedProviders, LoadedConfig } from "../types.js";

export function initProviders(config: LoadedConfig): InitializedProviders {
  const search: InitializedProviders["search"] = {};

  if (config.apiKeys.BRAVE_API_KEY) {
    search.brave = createBraveProvider(config.apiKeys.BRAVE_API_KEY);
  }
  if (config.apiKeys.SERPER_API_KEY) {
    search.serper = createSerperProviderFactory(config.apiKeys.SERPER_API_KEY);
  }
  if (config.apiKeys.TAVILY_API_KEY) {
    search.tavily = createTavilyProvider(config.apiKeys.TAVILY_API_KEY);
  }
  if (config.apiKeys.EXA_API_KEY) {
    search.exa = createExaProvider(config.apiKeys.EXA_API_KEY);
  }

  const fetch: InitializedProviders["fetch"] = {
    jina: createJinaProvider(config.apiKeys.JINA_API_KEY),
  };

  if (config.apiKeys.FIRECRAWL_API_KEY) {
    fetch.firecrawl = createFirecrawlProvider(config.apiKeys.FIRECRAWL_API_KEY);
  }

  return {
    search,
    fetch,
    hasAnySearchProvider: Object.keys(search).length > 0,
  };
}
