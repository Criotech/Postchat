import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL_NAME } from "./llmClient";

const FALLBACK_SUGGESTIONS = [
  "What endpoints require authentication?",
  "Show me all POST requests",
  "What is the base URL for this API?",
  "How do I handle errors in this API?"
];

const suggestionCache = new Map<string, string[]>();

type GenerateSuggestionsParams = {
  apiKey: string;
  provider: string;
  collectionMarkdown: string;
};

export async function generateSuggestions(params: GenerateSuggestionsParams): Promise<string[]> {
  const { apiKey, provider, collectionMarkdown } = params;
  const cacheKey = getCacheKey(collectionMarkdown);
  const cached = suggestionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!apiKey.trim()) {
    suggestionCache.set(cacheKey, FALLBACK_SUGGESTIONS);
    return FALLBACK_SUGGESTIONS;
  }

  try {
    const client = new Anthropic({ apiKey });
    const prompt = `Based on this API collection, generate exactly 4 short, specific questions a developer might ask. Return them as a JSON array of strings. Each question should be under 10 words. Focus on: auth, common endpoints, request formats, and error handling. Return ONLY the JSON array, nothing else.\n\n${collectionMarkdown}`;

    const response = await client.messages.create({
      model: provider || MODEL_NAME,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }]
    });

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();

    const parsed = parseSuggestions(text);
    suggestionCache.set(cacheKey, parsed);
    return parsed;
  } catch {
    suggestionCache.set(cacheKey, FALLBACK_SUGGESTIONS);
    return FALLBACK_SUGGESTIONS;
  }
}

function getCacheKey(collectionMarkdown: string): string {
  const input = collectionMarkdown.slice(0, 500);
  return createHash("sha256").update(input).digest("hex");
}

function parseSuggestions(raw: string): string[] {
  try {
    const candidate = extractJsonArray(raw);
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) {
      return FALLBACK_SUGGESTIONS;
    }

    const suggestions = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4);

    if (suggestions.length !== 4) {
      return FALLBACK_SUGGESTIONS;
    }

    return suggestions;
  } catch {
    return FALLBACK_SUGGESTIONS;
  }
}

function extractJsonArray(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed;
  }

  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON array found");
  }

  return trimmed.slice(start, end + 1);
}
