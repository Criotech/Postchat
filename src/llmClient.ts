import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import * as vscode from "vscode";

export const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
export const OPENAI_MODEL = "gpt-4o";
export const MAX_TOKENS = 4096;

// ── Token budget constants ───────────────────────────────────────────────────
// 1 token ≈ 4 characters (standard heuristic)
const CHARS_PER_TOKEN = 4;
const MAX_INPUT_TOKENS = 150_000;
const SYSTEM_PROMPT_BUDGET = 40_000;
const HISTORY_BUDGET = MAX_INPUT_TOKENS - SYSTEM_PROMPT_BUDGET;

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

export type SendMessageResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

export interface LlmProvider {
  readonly modelName: string;
  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

class AnthropicProvider implements LlmProvider {
  readonly modelName: string;

  constructor(private readonly apiKey: string, model: string) {
    this.modelName = model;
  }

  async sendMessage({
    systemPrompt,
    history,
    userMessage
  }: SendMessageParams): Promise<SendMessageResult> {
    const client = new Anthropic({ apiKey: this.apiKey });

    const trimmedPrompt = truncateSystemPrompt(systemPrompt);
    const trimmedHistory = truncateHistory(history, userMessage);
    const messages = [
      ...trimmedHistory.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user" as const, content: userMessage }
    ];

    try {
      const response = await client.messages.create({
        model: this.modelName,
        max_tokens: MAX_TOKENS,
        system: trimmedPrompt,
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

      return {
        text,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0
      };
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

  async sendMessage({
    systemPrompt,
    history,
    userMessage
  }: SendMessageParams): Promise<SendMessageResult> {
    const client = new OpenAI({ apiKey: this.apiKey });

    const trimmedPrompt = truncateSystemPrompt(systemPrompt);
    const trimmedHistory = truncateHistory(history, userMessage);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: trimmedPrompt },
      ...trimmedHistory.map((turn) => ({
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

      return {
        text,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0
      };
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

  async sendMessage({
    systemPrompt,
    history,
    userMessage
  }: SendMessageParams): Promise<SendMessageResult> {
    const trimmedPrompt = truncateSystemPrompt(systemPrompt);
    const trimmedHistory = truncateHistory(history, userMessage);
    const messages = [
      { role: "system", content: trimmedPrompt },
      ...trimmedHistory.map((turn) => ({ role: turn.role, content: turn.content })),
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

      const data = (await response.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const text = data?.message?.content?.trim() ?? "";

      if (!text) {
        throw new Error("Ollama returned an empty response.");
      }

      return {
        text,
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0
      };
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
  if (!collectionMarkdown) {
    return `You are a concise assistant in VS Code for an API exploration tool called Postchat.

Rules:
- Answer ONLY what the user asked. Nothing more.
- Do NOT repeat, rephrase, or restate the user's question.
- Keep answers as short as possible. A single sentence or a few bullet points is ideal.
- No greetings, sign-offs, or filler phrases.
- If the user asks about APIs or endpoints, let them know you can help once they ask a specific API question.`;
  }

  return `You are a concise API assistant in VS Code.

Rules:
- Answer ONLY what the user asked. Nothing more.
- Do NOT repeat, rephrase, or restate the user's question.
- Do NOT include information the user did not ask for.
- Do NOT add code snippets unless the user explicitly asks for code.
- Do NOT repeat information you already provided earlier in the conversation.
- Keep answers as short as possible. A single sentence or a few bullet points is ideal.
- If the answer is a single value, field name, or URL, just state it directly.
- No greetings, sign-offs, or filler phrases.

API documentation for reference:

${collectionMarkdown}`;
}

// ── Truncation helpers ────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Keep the most recent messages that fit within the history token budget.
 * Drops oldest messages first to preserve conversation continuity.
 */
function truncateHistory(history: Message[], userMessage: string): Message[] {
  const userMessageTokens = estimateTokens(userMessage);
  let budget = HISTORY_BUDGET - userMessageTokens;
  if (budget <= 0) {
    return [];
  }

  const trimmed: Message[] = [];
  // Walk from newest to oldest, accumulating until budget is exhausted
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(history[i].content);
    if (cost > budget) {
      break;
    }
    budget -= cost;
    trimmed.unshift(history[i]);
  }
  return trimmed;
}

/**
 * If the system prompt exceeds its budget, truncate the collection markdown
 * portion and append a warning note.
 */
function truncateSystemPrompt(prompt: string): string {
  const maxChars = SYSTEM_PROMPT_BUDGET * CHARS_PER_TOKEN;
  if (prompt.length <= maxChars) {
    return prompt;
  }
  return prompt.slice(0, maxChars) + "\n\n[...documentation truncated due to size limits]";
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
