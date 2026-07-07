import type { EditingMode } from "./modes.ts";
import {
  buildOllamaRequest,
  extractOllamaContent,
  type OllamaResponse,
} from "./ollama.ts";

export interface RewriteOptions {
  text: string;
  mode: EditingMode;
  apiKey?: string;
  ollamaUrl?: string;
}

const PROVIDER_URLS = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
} as const;

export async function rewriteText(
  options: RewriteOptions,
  signal?: AbortSignal,
): Promise<string> {
  const { mode } = options;

  return retryEchoedSystemPrompt(
    () => callProvider(options, signal),
    mode.systemPrompt,
  );
}

async function callProvider(
  options: RewriteOptions,
  signal?: AbortSignal,
): Promise<string> {
  const { mode } = options;
  let result: string;

  switch (mode.provider) {
    case "openai":
    case "groq":
      result = await callOpenAICompatible(
        PROVIDER_URLS[mode.provider],
        options,
        signal,
      );
      break;

    case "anthropic":
      result = await callAnthropic(options, signal);
      break;

    case "ollama":
      result = await callOllama(options, signal);
      break;

    default:
      throw new Error(`Unknown provider: ${mode.provider}`);
  }

  return result;
}

export function validateRewriteResult(
  result: string,
  systemPrompt: string,
): string {
  if (result.trim() === systemPrompt.trim()) {
    throw new Error("Модель вернула системную инструкцию вместо результата.");
  }
  return result;
}

export async function retryEchoedSystemPrompt(
  request: () => Promise<string>,
  systemPrompt: string,
): Promise<string> {
  const firstResult = await request();
  if (firstResult.trim() !== systemPrompt.trim()) {
    return validateRewriteResult(firstResult, systemPrompt);
  }

  return validateRewriteResult(await request(), systemPrompt);
}

async function callOllama(
  options: RewriteOptions,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = (options.ollamaUrl || "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildOllamaRequest(options.text, options.mode)),
    signal,
  });
  const payload = (await response.json()) as OllamaResponse;
  if (!response.ok)
    throw new Error(
      payload.error || `Ollama request failed: HTTP ${response.status}`,
    );
  return extractOllamaContent(payload);
}

function sanitizeError(message: string, apiKey?: string): string {
  if (!apiKey || apiKey.trim().length === 0) return message;
  return message.replaceAll(apiKey, "[REDACTED]");
}

export function buildOpenAICompatibleRequest(text: string, mode: EditingMode) {
  return {
    model: mode.model,
    messages: [
      { role: "system", content: mode.systemPrompt },
      { role: "user", content: text },
    ],
    temperature: mode.temperature,
    max_tokens: mode.maxTokens,
  };
}

async function callOpenAICompatible(
  baseUrl: string,
  options: RewriteOptions,
  signal?: AbortSignal,
): Promise<string> {
  const { text, apiKey, mode } = options;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey ?? ""}`,
    },
    body: JSON.stringify(buildOpenAICompatibleRequest(text, mode)),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `API error (${response.status}): ${sanitizeError(errorBody, apiKey)}`,
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No content in API response");
  }
  return content.trim();
}

export function buildAnthropicRequest(text: string, mode: EditingMode) {
  return {
    model: mode.model,
    system: mode.systemPrompt,
    messages: [{ role: "user", content: text }],
    temperature: mode.temperature,
    max_tokens: mode.maxTokens,
  };
}

async function callAnthropic(
  options: RewriteOptions,
  signal?: AbortSignal,
): Promise<string> {
  const { text, apiKey, mode } = options;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(buildAnthropicRequest(text, mode)),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `API error (${response.status}): ${sanitizeError(errorBody, apiKey)}`,
    );
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const content = data.content?.find((block) => block.type === "text")?.text;
  if (!content) {
    throw new Error("No text content in Anthropic response");
  }
  return content.trim();
}
