// ─── TYPES ─────────────────────────────────────────────────────

export type ContextDecision = 'none' | 'history' | 'filter';

// ─── SIGNAL PATTERNS ───────────────────────────────────────────

const GREETING_PATTERNS = [
  /^(hi|hello|hey|howdy|hola|sup|yo|greetings)\b/i,
  /^good\s+(morning|afternoon|evening|night)\b/i,
  /^what'?s?\s+up\b/i,
];

const ACKNOWLEDGEMENT_PATTERNS = [
  /^(thanks|thank\s+you|thx|ty|cheers|great|awesome|perfect|cool|nice|ok|okay|got\s+it|understood|sure|noted|alright)\b/i,
  /^(that'?s?\s+)?(helpful|clear|good|enough|all)\b/i,
  /^(no\s+)?(more\s+)?(questions?|that'?s?\s+it|that'?s?\s+all)\b/i,
];

const META_QUESTIONS = [
  /^(who|what)\s+are\s+you\b/i,
  /^(can|what\s+can)\s+you\s+(do|help)\b/i,
  /^how\s+do(es)?\s+(this|you)\s+work\b/i,
  /^help\b/i,
];

const REPEAT_PATTERNS = [
  /^(say\s+that\s+again|repeat|come\s+again)\b/i,
  /^(can\s+you\s+)?(rephrase|clarify|explain\s+(that|it)\s*(again|more)?)\b/i,
];

// ─── API SIGNAL DETECTION ──────────────────────────────────────

const API_SIGNAL_TERMS = [
  'endpoint', 'api', 'request', 'response', 'status',
  'auth', 'token', 'header', 'body', 'param',
  'schema', 'model', 'field', 'property',
  'curl', 'fetch', 'http', 'rest',
  'collection', 'swagger', 'openapi', 'postman',
];

const API_METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE)\b/;
const API_PATH_RE = /\/[a-z][a-z0-9\-/{}]*/i;
const API_STATUS_CODE_RE = /\b[1-5]\d{2}\b/;

function hasNoApiSignals(message: string): boolean {
  const lower = message.toLowerCase();

  // Check for API-related terms
  for (const term of API_SIGNAL_TERMS) {
    if (lower.includes(term)) { return false; }
  }

  // Check for HTTP methods
  if (API_METHOD_RE.test(message)) { return false; }

  // Check for URL path patterns
  if (API_PATH_RE.test(message)) { return false; }

  // Check for status codes
  if (API_STATUS_CODE_RE.test(message)) { return false; }

  return true;
}

// ─── PATTERN MATCHING ──────────────────────────────────────────

function matchesAnyPattern(message: string, patterns: RegExp[]): boolean {
  const trimmed = message.trim();
  return patterns.some(p => p.test(trimmed));
}

// ─── MAIN FUNCTION ─────────────────────────────────────────────

export function shouldSendContext(
  userMessage: string,
  history: { role: string; content: string }[],
): ContextDecision {
  const trimmed = userMessage.trim();

  // Very short messages (1-2 words) without API signals are conversational
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 2 && hasNoApiSignals(trimmed)) {
    // Exception: if there's a path or method, it's API-related
    if (!API_PATH_RE.test(trimmed) && !API_METHOD_RE.test(trimmed)) {
      return 'none';
    }
  }

  // Greetings never need context
  if (matchesAnyPattern(trimmed, GREETING_PATTERNS)) {
    return 'none';
  }

  // Acknowledgements never need context
  if (matchesAnyPattern(trimmed, ACKNOWLEDGEMENT_PATTERNS)) {
    return 'none';
  }

  // Meta questions about the assistant itself
  if (matchesAnyPattern(trimmed, META_QUESTIONS)) {
    return 'none';
  }

  // Repeat/rephrase requests: use history context only
  if (matchesAnyPattern(trimmed, REPEAT_PATTERNS)) {
    return history.length > 0 ? 'history' : 'none';
  }

  // If the message has no API signals at all and is relatively short,
  // it's probably conversational
  if (wordCount <= 6 && hasNoApiSignals(trimmed)) {
    return 'none';
  }

  // Default: run the full context filter
  return 'filter';
}
