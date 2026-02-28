import type { ParsedEndpoint, ParsedCollection } from '../specParser/types';
import type { AnalyzedQuery, HttpMethodHint } from './queryAnalyzer';

// ─── BM25 PARAMETERS ──────────────────────────────────────────

const BM25_K1 = 1.5;
const BM25_B = 0.75;

// ─── TYPES ─────────────────────────────────────────────────────

type IndexedDocument = {
  id: string;
  endpoint: ParsedEndpoint;
  terms: Map<string, number>;
  length: number;
};

export type SearchResult = {
  endpoint: ParsedEndpoint;
  score: number;
  matchedTerms: string[];
  matchedFields: string[];
};

export type BM25Index = {
  documents: IndexedDocument[];
  avgDocLength: number;
  idf: Map<string, number>;
  totalDocs: number;
  collectionId: string;
  builtAt: number;
};

// ─── FIELD BOOST WEIGHTS ───────────────────────────────────────

const FIELD_BOOST = {
  name: 4.0,
  path: 3.0,
  method: 2.0,
  folder: 2.0,
  description: 1.5,
  paramName: 2.0,
  paramDescription: 1.0,
  requestBody: 1.5,
  responseDescription: 1.0,
} as const;

// ─── STEMMING ──────────────────────────────────────────────────

function stem(token: string): string {
  if (token.length < 4) { return token; }
  if (token.endsWith('tion')) { return token.slice(0, -4); }
  if (token.endsWith('ing') && token.length > 5) { return token.slice(0, -3); }
  if (token.endsWith('ed') && token.length > 4) { return token.slice(0, -2); }
  if (token.endsWith('s') && !token.endsWith('ss')) { return token.slice(0, -1); }
  return token;
}

// ─── TOKENIZER ─────────────────────────────────────────────────

const SPLIT_RE = /[\s/\-_.\{\}\[\]()]+/g;

function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .split(SPLIT_RE)
    .filter(t => t.length >= 2)
    .filter(t => !/^\d+$/.test(t) || /^[1-5]\d{2}$/.test(t))
    .map(stem);
}

function addTokens(
  terms: Map<string, number>,
  text: string | undefined,
  boost: number,
): void {
  if (!text) { return; }
  for (const token of tokenizeText(text)) {
    terms.set(token, (terms.get(token) ?? 0) + boost);
  }
}

function tokenizeEndpoint(endpoint: ParsedEndpoint): Map<string, number> {
  const terms = new Map<string, number>();

  addTokens(terms, endpoint.name, FIELD_BOOST.name);
  addTokens(terms, endpoint.path, FIELD_BOOST.path);
  addTokens(terms, endpoint.method, FIELD_BOOST.method);
  addTokens(terms, endpoint.folder, FIELD_BOOST.folder);
  addTokens(terms, endpoint.description, FIELD_BOOST.description);

  // Parameters
  for (const param of endpoint.parameters) {
    addTokens(terms, param.name, FIELD_BOOST.paramName);
    addTokens(terms, param.description, FIELD_BOOST.paramDescription);
  }

  // Request body
  addTokens(terms, endpoint.requestBody, FIELD_BOOST.requestBody);

  // Responses
  for (const resp of endpoint.responses) {
    addTokens(terms, resp.description, FIELD_BOOST.responseDescription);
    // Index status codes as tokens
    addTokens(terms, resp.statusCode, FIELD_BOOST.responseDescription);
  }

  // Extract path segments joined (e.g. "users orders" from /users/{id}/orders)
  const pathSegments = endpoint.path
    .split('/')
    .filter(s => s.length > 0 && !/^\{.*\}$/.test(s))
    .join(' ');
  addTokens(terms, pathSegments, FIELD_BOOST.path);

  return terms;
}

// ─── HASHING ───────────────────────────────────────────────────

function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(36);
}

function collectionHash(collection: ParsedCollection): string {
  const firstId = collection.endpoints.length > 0 ? collection.endpoints[0].id : '';
  return djb2(`${collection.title}|${collection.endpoints.length}|${firstId}`);
}

// ─── INDEX BUILDER ─────────────────────────────────────────────

export function buildIndex(collection: ParsedCollection): BM25Index {
  const collectionId = collectionHash(collection);

  const documents: IndexedDocument[] = collection.endpoints.map(endpoint => {
    const terms = tokenizeEndpoint(endpoint);
    let length = 0;
    terms.forEach(freq => { length += freq; });
    return { id: endpoint.id, endpoint, terms, length };
  });

  const totalDocs = documents.length;
  const avgDocLength = totalDocs > 0
    ? documents.reduce((sum, d) => sum + d.length, 0) / totalDocs
    : 1;

  // Calculate IDF for every term across the corpus
  const docFrequency = new Map<string, number>();
  for (const doc of documents) {
    doc.terms.forEach((_freq, term) => {
      docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    });
  }

  const idf = new Map<string, number>();
  docFrequency.forEach((df, term) => {
    idf.set(term, Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1));
  });

  return {
    documents,
    avgDocLength,
    idf,
    totalDocs,
    collectionId,
    builtAt: Date.now(),
  };
}

// ─── SEARCH ────────────────────────────────────────────────────

export function searchIndex(
  index: BM25Index,
  query: AnalyzedQuery,
  options: {
    topK?: number;
    minScore?: number;
    methodFilter?: HttpMethodHint;
    boostEntityTerms?: boolean;
  } = {},
): SearchResult[] {
  const {
    topK = 8,
    minScore = 0.1,
    methodFilter = query.methodHint,
    boostEntityTerms = true,
  } = options;

  // Build stemmed query terms
  const rawTerms = [...query.keywords, ...query.entityTerms];
  const seen = new Set<string>();
  const queryTerms: string[] = [];
  for (const t of rawTerms) {
    const stemmed = stem(t.toLowerCase());
    if (stemmed.length >= 2 && !seen.has(stemmed)) {
      seen.add(stemmed);
      queryTerms.push(stemmed);
    }
  }

  if (queryTerms.length === 0) { return []; }

  // Also stem entity terms for boost comparison
  const stemmedEntityTerms = new Set(
    query.entityTerms.map(t => stem(t.toLowerCase())),
  );

  // Score each document
  const scored: SearchResult[] = [];

  for (const doc of index.documents) {
    let score = 0;
    const matchedTerms: string[] = [];
    const matchedFields: string[] = [];

    for (const queryTerm of queryTerms) {
      const tf = doc.terms.get(queryTerm) ?? 0;
      if (tf <= 0) { continue; }

      matchedTerms.push(queryTerm);

      const idfScore = index.idf.get(queryTerm) ?? 0;

      // BM25 term score
      const numerator = tf * (BM25_K1 + 1);
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / index.avgDocLength));
      let termScore = idfScore * (numerator / denominator);

      // Boost entity terms
      if (boostEntityTerms && stemmedEntityTerms.has(queryTerm)) {
        termScore *= 1.8;
      }

      // Boost if matches the method hint
      if (methodFilter && methodFilter !== 'any') {
        if (doc.endpoint.method === methodFilter) {
          termScore *= 1.5;
        }
      }

      // Boost exact path matches
      if (query.endpointHint) {
        if (doc.endpoint.path.toLowerCase().includes(query.endpointHint.toLowerCase())) {
          termScore *= 3.0;
        }
      }

      // Boost by intent: auth
      if (query.intent === 'understand_auth' && doc.endpoint.requiresAuth) {
        termScore *= 2.0;
      }

      // Boost by intent: debug error with status code
      if (query.intent === 'debug_error' && query.statusCodeHint) {
        const hasStatusCode = doc.endpoint.responses.some(
          r => r.statusCode === String(query.statusCodeHint),
        );
        if (hasStatusCode) {
          termScore *= 2.5;
        }
      }

      score += termScore;
    }

    if (score > 0) {
      scored.push({ endpoint: doc.endpoint, score, matchedTerms, matchedFields });
    }
  }

  // Apply method filter
  if (methodFilter && methodFilter !== 'any') {
    const filtered = scored.filter(r => r.endpoint.method === methodFilter);
    // Only apply if it doesn't eliminate all results
    if (filtered.length > 0) {
      return filtered
        .sort((a, b) => b.score - a.score)
        .filter(r => r.score >= minScore)
        .slice(0, topK);
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .filter(r => r.score >= minScore)
    .slice(0, topK);
}

// ─── CACHE ─────────────────────────────────────────────────────

const MAX_CACHE_SIZE = 5;

const indexCache = new Map<string, BM25Index>();

export function getOrBuildIndex(collection: ParsedCollection): BM25Index {
  const id = collectionHash(collection);

  const cached = indexCache.get(id);
  if (cached) { return cached; }

  // LRU eviction: remove oldest entry if at capacity
  if (indexCache.size >= MAX_CACHE_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    indexCache.forEach((idx, key) => {
      if (idx.builtAt < oldestTime) {
        oldestTime = idx.builtAt;
        oldestKey = key;
      }
    });
    if (oldestKey) {
      indexCache.delete(oldestKey);
    }
  }

  const index = buildIndex(collection);
  indexCache.set(id, index);
  return index;
}

export function invalidateIndex(collectionId: string): void {
  indexCache.delete(collectionId);
}
