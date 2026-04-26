/**
 * v2 Phase B — tool-level error boundary.
 *
 * Wraps an MCP tool handler so any thrown error becomes a structured
 * response payload (isError: true) instead of a 500 from the Worker
 * runtime. Logs the error name + message to console (for `wrangler tail`)
 * but NOT the input params, which may contain user copy or prompts that
 * could be sensitive.
 *
 * Usage:
 *   server.tool(
 *     "tool_name",
 *     "description",
 *     ZodSchema.shape,
 *     withToolErrorBoundary("tool_name", async (params) => { ... })
 *   );
 */

type ToolHandlerResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function withToolErrorBoundary<P>(
  toolName: string,
  handler: (params: P) => Promise<ToolHandlerResult>
): (params: P) => Promise<ToolHandlerResult> {
  return async (params: P) => {
    try {
      return await handler(params);
    } catch (err) {
      const errName = err instanceof Error ? err.name : "UnknownError";
      const errMsg = err instanceof Error ? err.message : String(err);
      // Worker runtime captures console.error in `wrangler tail`. Don't
      // log params — could contain user copy or prompts.
      console.error(`[mcp:${toolName}] ${errName}: ${errMsg}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              tool: toolName,
              error: errMsg,
              error_type: errName,
            }),
          },
        ],
        isError: true,
      };
    }
  };
}
