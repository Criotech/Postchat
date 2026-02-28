// ─── TYPES ─────────────────────────────────────────────────────

export type QueryIntent =
  | 'find_endpoint'
  | 'understand_auth'
  | 'understand_schema'
  | 'run_request'
  | 'debug_error'
  | 'generate_code'
  | 'compare_endpoints'
  | 'list_endpoints'
  | 'general';

export type HttpMethodHint =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'any';

export type AnalyzedQuery = {
  original: string;
  normalized: string;
  intent: QueryIntent;
  methodHint: HttpMethodHint;
  keywords: string[];
  entityTerms: string[];
  statusCodeHint: number | null;
  endpointHint: string | null;
  isGlobalQuery: boolean;
  isSingleEndpointQuery: boolean;
};

// ─── CONSTANTS ─────────────────────────────────────────────────

const GLOBAL_QUERY_SIGNALS = [
  'all endpoints', 'all routes', 'all apis', 'list all', 'show all',
  'summarize', 'overview', 'what can', 'what does this api',
  'how many endpoints', 'full list', 'everything', 'complete list',
  'what endpoints', 'which endpoints',
];

const METHOD_SIGNALS: Record<string, HttpMethodHint> = {
  'create': 'POST', 'add': 'POST', 'post': 'POST', 'submit': 'POST',
  'new': 'POST', 'insert': 'POST', 'register': 'POST', 'upload': 'POST',
  'get': 'GET', 'fetch': 'GET', 'retrieve': 'GET', 'list': 'GET',
  'read': 'GET', 'show': 'GET', 'find': 'GET', 'search': 'GET',
  'load': 'GET', 'download': 'GET',
  'update': 'PUT', 'edit': 'PUT', 'modify': 'PUT', 'change': 'PUT',
  'replace': 'PUT', 'set': 'PUT',
  'patch': 'PATCH', 'partial': 'PATCH',
  'delete': 'DELETE', 'remove': 'DELETE', 'destroy': 'DELETE',
  'cancel': 'DELETE', 'revoke': 'DELETE',
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for',
  'of', 'and', 'or', 'but', 'how', 'what', 'where', 'when', 'why',
  'do', 'does', 'can', 'could', 'would', 'should', 'will', 'i',
  'me', 'my', 'this', 'that', 'with', 'from', 'by', 'be', 'am',
  'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
  'endpoint', 'api', 'request', 'response', 'call', 'use', 'using',
]);

const KNOWN_RESOURCE_WORDS = new Set([
  'user', 'order', 'product', 'item', 'account',
  'payment', 'token', 'session', 'message', 'file',
  'image', 'report', 'invoice', 'subscription',
  'permission', 'role', 'team', 'org', 'workspace',
]);

// ─── HELPERS ───────────────────────────────────────────────────

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\w\s/\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectGlobalQuery(normalized: string): boolean {
  return GLOBAL_QUERY_SIGNALS.some(signal => normalized.includes(signal));
}

function detectMethodHint(normalized: string, original: string): HttpMethodHint {
  // Check for literal "METHOD /" patterns first — they take priority
  const literalMatch = original.match(/\b(GET|POST|PUT|PATCH|DELETE)\s*\//i);
  if (literalMatch) {
    return literalMatch[1].toUpperCase() as HttpMethodHint;
  }

  // Fall back to word-level signals
  const words = normalized.split(' ');
  for (const word of words) {
    if (word in METHOD_SIGNALS) {
      return METHOD_SIGNALS[word];
    }
  }

  return 'any';
}

function detectStatusCode(normalized: string): number | null {
  const match = normalized.match(/\b([1-5]\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

function detectEndpointHint(normalized: string): string | null {
  const match = normalized.match(/\/[a-z][a-z0-9\-/{}]*/i);
  return match ? match[0] : null;
}

function extractKeywords(normalized: string): string[] {
  const words = normalized.split(' ');
  const seen = new Set<string>();
  const result: string[] = [];

  for (const word of words) {
    if (word.length < 2) { continue; }
    if (STOP_WORDS.has(word)) { continue; }
    if (/^\d+$/.test(word)) { continue; }
    if (seen.has(word)) { continue; }
    seen.add(word);
    result.push(word);
  }

  result.sort((a, b) => b.length - a.length);
  return result.slice(0, 10);
}

function extractEntityTerms(keywords: string[], endpointHint: string | null): string[] {
  const entities = new Set<string>();

  for (const word of keywords) {
    // Direct match against known resources
    if (KNOWN_RESOURCE_WORDS.has(word)) {
      entities.add(word);
      continue;
    }
    // Check plural form (strip trailing 's')
    if (word.endsWith('s') && KNOWN_RESOURCE_WORDS.has(word.slice(0, -1))) {
      entities.add(word);
      continue;
    }
  }

  // Extract path segments from endpointHint
  if (endpointHint) {
    const segments = endpointHint
      .split('/')
      .filter(s => s.length > 0 && !/^\{.*\}$/.test(s));
    for (const seg of segments) {
      entities.add(seg);
    }
  }

  return Array.from(entities);
}

function detectIntent(
  normalized: string,
  isGlobalQuery: boolean,
  methodHint: HttpMethodHint,
  entityTerms: string[],
  statusCodeHint: number | null,
): QueryIntent {
  const has = (...terms: string[]) => terms.some(t => normalized.includes(t));

  if (has('auth', 'login', 'token', 'oauth', 'bearer', 'api key', 'authenticate', 'authorization')) {
    return 'understand_auth';
  }

  if (statusCodeHint !== null) {
    return 'debug_error';
  }

  if (has('code', 'snippet', 'example', 'function', 'implement', 'write', 'generate')) {
    return 'generate_code';
  }

  if (isGlobalQuery) {
    return 'list_endpoints';
  }

  if (methodHint !== 'any' && entityTerms.length > 0) {
    return 'find_endpoint';
  }

  if (has('schema', 'model', 'object', 'body', 'format', 'structure', 'fields', 'properties')) {
    return 'understand_schema';
  }

  if (has('difference', 'vs', 'versus', 'compare')) {
    return 'compare_endpoints';
  }

  if (has('run', 'execute', 'call', 'try')) {
    return 'run_request';
  }

  return 'general';
}

// ─── MAIN FUNCTION ─────────────────────────────────────────────

export function analyzeQuery(userMessage: string): AnalyzedQuery {
  const normalized = normalize(userMessage);
  const isGlobalQuery = detectGlobalQuery(normalized);
  const methodHint = detectMethodHint(normalized, userMessage);
  const statusCodeHint = detectStatusCode(normalized);
  const endpointHint = detectEndpointHint(normalized);
  const keywords = extractKeywords(normalized);
  const entityTerms = extractEntityTerms(keywords, endpointHint);
  const intent = detectIntent(normalized, isGlobalQuery, methodHint, entityTerms, statusCodeHint);

  const isSingleEndpointQuery =
    (intent === 'find_endpoint' || intent === 'run_request' || intent === 'generate_code')
    && endpointHint !== null;

  return {
    original: userMessage,
    normalized,
    intent,
    methodHint,
    keywords,
    entityTerms,
    statusCodeHint,
    endpointHint,
    isGlobalQuery,
    isSingleEndpointQuery,
  };
}

// ─── DEBUG HELPER ──────────────────────────────────────────────

export function formatQuerySummary(query: AnalyzedQuery): string {
  const parts = [
    `intent=${query.intent}`,
    `method=${query.methodHint}`,
    `entities=[${query.entityTerms.join(',')}]`,
    `keywords=[${query.keywords.join(',')}]`,
  ];

  if (query.statusCodeHint !== null) {
    parts.push(`status=${query.statusCodeHint}`);
  }
  if (query.endpointHint !== null) {
    parts.push(`path=${query.endpointHint}`);
  }
  if (query.isGlobalQuery) {
    parts.push('global=true');
  }
  if (query.isSingleEndpointQuery) {
    parts.push('single=true');
  }

  return parts.join(' ');
}
