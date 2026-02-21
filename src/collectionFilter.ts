const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "me", "my", "i", "you", "your", "we",
  "how", "what", "which", "when", "where", "who", "this", "that", "it",
  "show", "give", "tell", "list", "find", "get", "run", "use", "make",
  "please", "help", "need", "want", "like", "example", "all", "any"
]);

const MAX_ENDPOINTS_IN_CONTEXT = 30;

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreBlock(block: string, keywords: string[]): number {
  const lower = block.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    // Title/method line match scores higher
    const titleLine = block.split("\n")[0].toLowerCase();
    if (titleLine.includes(kw)) {
      score += 3;
    } else if (lower.includes(kw)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Returns a filtered subset of the collection markdown containing only the
 * endpoints most relevant to the user's query.
 *
 * If the query is broad (e.g. "summarize") or matches too few blocks, falls
 * back to an evenly-sampled set so the LLM still has a representative view.
 */
export function filterCollectionMarkdown(markdown: string, userQuery: string): string {
  const keywords = extractKeywords(userQuery);
  const endpointHeaderPattern = /^### (?:\[[A-Z]+]|[A-Z]+) /m;

  // Split into header (before first ###) and endpoint blocks
  const match = endpointHeaderPattern.exec(markdown);
  const firstBlockIndex = match?.index ?? -1;
  const header = firstBlockIndex > 0 ? markdown.slice(0, firstBlockIndex).trim() : "";
  const blockSection = firstBlockIndex >= 0 ? markdown.slice(firstBlockIndex) : markdown;

  const blocks = blockSection
    .split(/(?=^### (?:\[[A-Z]+]|[A-Z]+) )/m)
    .filter((b) => b.trim());

  // If the collection fits within budget, send it all
  if (blocks.length <= MAX_ENDPOINTS_IN_CONTEXT) {
    return markdown;
  }

  // Score and sort blocks by relevance
  const scored = blocks.map((block) => ({ block, score: scoreBlock(block, keywords) }));
  scored.sort((a, b) => b.score - a.score);

  const topBlocks = scored.slice(0, MAX_ENDPOINTS_IN_CONTEXT);
  const hasRelevantMatches = topBlocks.some((b) => b.score > 0);

  let selectedBlocks: string[];

  if (hasRelevantMatches) {
    selectedBlocks = topBlocks.filter((b) => b.score > 0).map((b) => b.block);
  } else {
    // No keyword matches — sample evenly across the collection so the LLM
    // gets a representative overview rather than just the first N endpoints
    const step = Math.floor(blocks.length / MAX_ENDPOINTS_IN_CONTEXT);
    selectedBlocks = blocks.filter((_, i) => i % step === 0).slice(0, MAX_ENDPOINTS_IN_CONTEXT);
  }

  const truncationNote =
    `> **Note:** Showing ${selectedBlocks.length} of ${blocks.length} endpoints ` +
    `most relevant to your query. Ask about specific endpoints to see their full details.\n\n`;

  return [header, truncationNote, ...selectedBlocks].filter(Boolean).join("\n\n");
}
