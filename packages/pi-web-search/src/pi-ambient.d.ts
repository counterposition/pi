declare module "@mariozechner/pi-coding-agent" {
  export interface ExtensionAPI {
    on(event: string, handler: (...args: any[]) => unknown): void;
    registerTool(tool: {
      name: string;
      label?: string;
      description?: string;
      parameters: unknown;
      execute: (
        toolCallId: string,
        params: any,
        signal: AbortSignal,
        onUpdate?: (update: unknown) => void,
        ctx?: unknown,
      ) => Promise<unknown>;
    }): void;
  }
}

declare module "@mariozechner/pi-ai" {
  export const Type: {
    Object(schema: Record<string, unknown>, options?: Record<string, unknown>): unknown;
    String(options?: Record<string, unknown>): unknown;
    Optional(schema: unknown): unknown;
    Array(schema: unknown, options?: Record<string, unknown>): unknown;
    Number(options?: Record<string, unknown>): unknown;
  };

  export function StringEnum(values: readonly string[], options?: Record<string, unknown>): unknown;
}
