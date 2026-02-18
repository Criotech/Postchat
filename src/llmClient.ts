import Anthropic from "@anthropic-ai/sdk";

export const MODEL_NAME = "claude-3-5-sonnet-20241022";
export const MAX_TOKENS = 4096;

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

type SendMessageParams = {
  apiKey: string;
  collectionMarkdown: string;
  conversationHistory: ConversationTurn[];
  userMessage: string;
};

export async function sendMessage(params: SendMessageParams): Promise<string> {
  const { apiKey, collectionMarkdown, conversationHistory, userMessage } = params;

  if (!apiKey.trim()) {
    throw new Error("Missing Anthropic API key. Set postchat.apiKey in VS Code settings.");
  }

  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are an expert API assistant embedded in VS Code. The user will ask questions
about their API. Use the Postman collection documentation below to give accurate,
helpful answers. Include code snippets (curl, JS fetch, Python requests) where useful.

--- POSTMAN COLLECTION ---
${collectionMarkdown}
---`;

  const messages = [
    ...conversationHistory.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content: userMessage }
  ];

  try {
    const response = await client.messages.create({
      model: MODEL_NAME,
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

    const message =
      error instanceof Error
        ? error.message
        : "Unknown error while requesting Anthropic response.";

    if (status === 401 || status === 403) {
      throw new Error(
        "Anthropic API key is invalid or unauthorized. Verify postchat.apiKey and try again."
      );
    }

    throw new Error(`Failed to get LLM response: ${message}`);
  }
}
