import Anthropic from "@anthropic-ai/sdk";
import Langfuse from "langfuse";

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

export function createLangfuse(config: LangfuseConfig): Langfuse {
  return new Langfuse({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
  });
}

export interface TracedClaudeCallParams {
  client: Anthropic;
  langfuse: Langfuse;
  traceId: string;
  spanName: string;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
}

export async function tracedClaudeCall(
  params: TracedClaudeCallParams
): Promise<Anthropic.Message> {
  const trace = params.langfuse.trace({ id: params.traceId });
  const span = trace.span({ name: params.spanName });

  const response = await params.client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.system,
    messages: params.messages,
  });

  span.end({
    output:
      response.content[0].type === "text" ? response.content[0].text.slice(0, 500) : "",
  });

  return response;
}
