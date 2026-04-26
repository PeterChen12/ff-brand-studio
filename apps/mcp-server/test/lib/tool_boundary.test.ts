import { describe, expect, it } from "vitest";
import { withToolErrorBoundary } from "../../src/lib/tool_boundary.js";

describe("withToolErrorBoundary", () => {
  it("returns the handler's value on success", async () => {
    const handler = withToolErrorBoundary("test_tool", async (params: { x: number }) => ({
      content: [{ type: "text" as const, text: `value=${params.x}` }],
    }));
    const result = await handler({ x: 42 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("value=42");
  });

  it("converts thrown Error into structured isError response", async () => {
    const handler = withToolErrorBoundary("test_tool", async () => {
      throw new Error("boom");
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.tool).toBe("test_tool");
    expect(parsed.error).toBe("boom");
    expect(parsed.error_type).toBe("Error");
  });

  it("captures custom error types", async () => {
    class DbConnError extends Error {
      override name = "DbConnError";
    }
    const handler = withToolErrorBoundary("test_tool", async () => {
      throw new DbConnError("postgres down");
    });
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error_type).toBe("DbConnError");
    expect(parsed.error).toBe("postgres down");
  });

  it("handles non-Error throws", async () => {
    const handler = withToolErrorBoundary("test_tool", async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "string-throw";
    });
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("string-throw");
    expect(parsed.error_type).toBe("UnknownError");
  });
});
