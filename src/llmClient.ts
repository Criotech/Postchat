import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import * as vscode from "vscode";

export const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
export const OPENAI_MODEL = "gpt-4o";
export const MAX_TOKENS = 4096;

// Backward-compat alias used by promptSuggester.ts
export const MODEL_NAME = ANTHROPIC_MODEL;

type Message = {
  role: "user" | "assistant";
  content: string;
};

type SendMessageParams = {
  systemPrompt: string;
  history: Message[];
  userMessage: string;
};

export interface LlmProvider {
  readonly modelName: string;
  sendMessage(params: SendMessageParams): Promise<string>;
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

class AnthropicProvider implements LlmProvider {
  readonly modelName: string;

  constructor(private readonly apiKey: string, model: string) {
    this.modelName = model;
  }

  async sendMessage({ systemPrompt, history, userMessage }: SendMessageParams): Promise<string> {
    const client = new Anthropic({ apiKey: this.apiKey });

    const messages = [
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user" as const, content: userMessage }
    ];

    try {
      const response = await client.messages.create({
        model: this.modelName,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages
      });

      const text = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .filter(Boolean)
        .join("\n")
        .trim();

      if (!text) {
        throw new Error("LLM returned an empty response.");
      }

      return text;
    } catch (error: unknown) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status?: number }).status)
          : undefined;

      if (status === 401 || status === 403) {
        throw new Error(
          "Anthropic API key is invalid or unauthorized. Verify postchat.apiKey and try again."
        );
      }

      if (isNetworkError(error)) {
        throw new Error(
          "Network error while contacting Anthropic. Please check your connection and try again."
        );
      }

      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while requesting Anthropic response.";
      throw new Error(`Failed to get LLM response: ${message}`);
    }
  }
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

class OpenAiProvider implements LlmProvider {
  readonly modelName: string;

  constructor(private readonly apiKey: string, model: string) {
    this.modelName = model;
  }

  async sendMessage({ systemPrompt, history, userMessage }: SendMessageParams): Promise<string> {
    const client = new OpenAI({ apiKey: this.apiKey });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((turn) => ({
        role: turn.role as "user" | "assistant",
        content: turn.content
      })),
      { role: "user", content: userMessage }
    ];

    try {
      const response = await client.chat.completions.create({
        model: this.modelName,
        max_tokens: MAX_TOKENS,
        messages
      });

      const text = response.choices[0]?.message?.content?.trim() ?? "";

      if (!text) {
        throw new Error("OpenAI returned an empty response.");
      }

      return text;
    } catch (error: unknown) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status?: number }).status)
          : undefined;

      if (status === 401 || status === 403) {
        throw new Error(
          "OpenAI API key is invalid or unauthorized. Verify postchat.openaiApiKey and try again."
        );
      }

      if (isNetworkError(error)) {
        throw new Error(
          "Network error while contacting OpenAI. Please check your connection and try again."
        );
      }

      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while requesting OpenAI response.";
      throw new Error(`Failed to get LLM response: ${message}`);
    }
  }
}

// ── Ollama ────────────────────────────────────────────────────────────────────

class OllamaProvider implements LlmProvider {
  readonly modelName: string;
  private readonly endpoint: string;

  constructor(endpoint: string, model: string) {
    this.endpoint = endpoint;
    this.modelName = model;
  }

  async sendMessage({ systemPrompt, history, userMessage }: SendMessageParams): Promise<string> {
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user", content: userMessage }
    ];

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.modelName, messages, stream: false })
      });

      if (!response.ok) {
        throw new Error(`Ollama server responded with status ${response.status}.`);
      }

      const data = (await response.json()) as { message?: { content?: string } };
      const text = data?.message?.content?.trim() ?? "";

      if (!text) {
        throw new Error("Ollama returned an empty response.");
      }

      return text;
    } catch (error: unknown) {
      if (isNetworkError(error)) {
        throw new Error(
          `Could not connect to Ollama at ${this.endpoint}. Make sure Ollama is running locally.`
        );
      }

      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while requesting Ollama response.";
      throw new Error(`Failed to get Ollama response: ${message}`);
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function getProvider(config: vscode.WorkspaceConfiguration): LlmProvider {
  const provider = config.get<string>("provider", "anthropic");

  if (provider === "openai") {
    const apiKey = config.get<string>("openaiApiKey", "").trim();
    const model = config.get<string>("openaiModel", OPENAI_MODEL).trim() || OPENAI_MODEL;
    return new OpenAiProvider(apiKey, model);
  }

  if (provider === "ollama") {
    const endpoint = config.get<string>("ollamaEndpoint", "http://localhost:11434").trim();
    const model = config.get<string>("ollamaModel", "llama3").trim();
    return new OllamaProvider(endpoint, model);
  }

  // Default: anthropic
  const apiKey = config.get<string>("apiKey", "").trim();
  const model = config.get<string>("anthropicModel", ANTHROPIC_MODEL).trim() || ANTHROPIC_MODEL;
  return new AnthropicProvider(apiKey, model);
}

export function buildSystemPrompt(collectionMarkdown: string): string {
  return `You are an expert API assistant embedded in VS Code. The user will ask questions
about their API. Use the Postman collection documentation below to give accurate,
helpful answers. Include code snippets (curl, JS fetch, Python requests) where useful.

--- POSTMAN COLLECTION ---
${collectionMarkdown}
---`;
}

// ── Network helper ────────────────────────────────────────────────────────────

function isNetworkError(error: unknown): boolean {
  const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const markers = [
    "network",
    "fetch",
    "econnreset",
    "enotfound",
    "etimedout",
    "timed out",
    "socket hang up"
  ];
  return markers.some((marker) => text.includes(marker));
}
