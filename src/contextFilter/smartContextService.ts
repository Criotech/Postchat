import * as vscode from 'vscode';
import type { ParsedCollection, ParsedEndpoint } from '../specParser/types';
import { collectionToMarkdown } from '../specParser';
import { analyzeQuery, isFollowUpQuery, extractSearchableFragment, type AnalyzedQuery } from './queryAnalyzer';
import { getOrBuildIndex, searchIndex, invalidateIndex, type SearchResult } from './bm25Index';
import { buildContext, buildHistoryOnlyContext, estimateTokens } from './contextBuilder';
import { shouldSendContext, type ContextDecision } from './contextGate';

// ─── TYPES ─────────────────────────────────────────────────────

export type ContextFilterStats = {
  totalEndpoints: number;
  sentFull: number;
  sentSummary: number;
  excluded: number;
  estimatedInputTokens: number;
  estimatedCostSavingPercent: number;
  processingTimeMs: number;
  budgetMode: string;
  gateDecision: ContextDecision;
};

export type ContextFilterResult = {
  contextMarkdown: string;
  analyzedQuery: AnalyzedQuery | null;
  stats: ContextFilterStats;
};

// ─── CONSTANTS ─────────────────────────────────────────────────

const SMALL_COLLECTION_THRESHOLD = 10;
const HISTORY_SCAN_DEPTH = 6;
const CONTINUITY_BOOST = 1.4;

// ─── CONVERSATION HISTORY AWARENESS ───────────────────────────

function extractMentionedEndpoints(
  history: { role: string; content: string }[],
  collection: ParsedCollection,
): string[] {
  const recentMessages = history.slice(-HISTORY_SCAN_DEPTH);
  if (recentMessages.length === 0) { return []; }

  const combined = recentMessages.map(m => m.content).join('\n').toLowerCase();
  const matchedIds = new Set<string>();

  // Build a lowercase name map for efficient lookup
  const endpointsByName = new Map<string, string>();
  for (const ep of collection.endpoints) {
    endpointsByName.set(ep.name.toLowerCase(), ep.id);
  }

  // Scan for endpoint name mentions
  endpointsByName.forEach((id, name) => {
    if (combined.includes(name)) {
      matchedIds.add(id);
    }
  });

  // Scan for method + path patterns: "GET /users", "POST /auth/login" etc.
  const methodPathMatches = combined.match(/\b(get|post|put|patch|delete)\s+\/[a-z][a-z0-9\-/{}]*/gi) || [];
  for (const match of methodPathMatches) {
    const parts = match.trim().split(/\s+/);
    if (parts.length < 2) { continue; }
    const method = parts[0].toUpperCase();
    const path = parts[1];
    for (const ep of collection.endpoints) {
      if (ep.method === method && ep.path.toLowerCase() === path.toLowerCase()) {
        matchedIds.add(ep.id);
      }
    }
  }

  // Scan for bare URL path patterns
  const pathMatches = combined.match(/\/[a-z][a-z0-9\-/{}]*/gi) || [];
  for (const pathMatch of pathMatches) {
    for (const ep of collection.endpoints) {
      if (ep.path.toLowerCase() === pathMatch.toLowerCase()) {
        matchedIds.add(ep.id);
      }
    }
  }

  return Array.from(matchedIds);
}

function boostMentionedEndpoints(
  results: SearchResult[],
  mentionedIds: string[],
): SearchResult[] {
  if (mentionedIds.length === 0) { return results; }
  const idSet = new Set(mentionedIds);
  return results.map(r => {
    if (idSet.has(r.endpoint.id)) {
      return { ...r, score: r.score * CONTINUITY_BOOST };
    }
    return r;
  });
}

// ─── FOLLOW-UP HANDLING ───────────────────────────────────────

function getLastDiscussedEndpoint(
  history: { role: string; content: string }[],
  collection: ParsedCollection,
): ParsedEndpoint | null {
  // Walk backwards through assistant messages to find the last endpoint discussed
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'assistant') { continue; }
    const content = history[i].content.toLowerCase();

    for (const ep of collection.endpoints) {
      // Check for method + path in the assistant response
      const signature = `${ep.method.toLowerCase()} ${ep.path.toLowerCase()}`;
      if (content.includes(signature) || content.includes(ep.name.toLowerCase())) {
        return ep;
      }
    }
  }
  return null;
}

function mergeFollowUpResults(
  previousEndpoint: ParsedEndpoint,
  newResults: SearchResult[],
): SearchResult[] {
  // If the previous endpoint is already in results, boost it
  const existing = newResults.find(r => r.endpoint.id === previousEndpoint.id);
  if (existing) {
    return newResults.map(r => {
      if (r.endpoint.id === previousEndpoint.id) {
        return { ...r, score: r.score * 2.0 };
      }
      return r;
    });
  }

  // Otherwise inject it at the top with a high score
  const topScore = newResults.length > 0 ? newResults[0].score : 1.0;
  return [
    {
      endpoint: previousEndpoint,
      score: topScore * 1.5,
      matchedTerms: ['(follow-up)'],
      matchedFields: [],
    },
    ...newResults,
  ];
}

// ─── BUDGET MODE ──────────────────────────────────────────────

function determineBudgetMode(
  query: AnalyzedQuery,
  _history: { role: string; content: string }[],
): 'conservative' | 'balanced' | 'generous' {
  if (query.isGlobalQuery) { return 'generous'; }
  if (query.intent === 'compare_endpoints') { return 'generous'; }
  if (query.intent === 'understand_auth') { return 'generous'; }

  if (query.isSingleEndpointQuery) { return 'conservative'; }
  if (query.intent === 'run_request') { return 'conservative'; }

  return 'balanced';
}

// ─── SETTINGS ─────────────────────────────────────────────────

function readFilterSettings(): {
  enabled: boolean;
  budgetOverride: 'conservative' | 'balanced' | 'generous' | 'auto';
} {
  const config = vscode.workspace.getConfiguration('postchat');
  const enabled = config.get<boolean>('contextFilter.enabled', true);
  const budget = config.get<string>('contextFilter.budgetMode', 'auto');

  let budgetOverride: 'conservative' | 'balanced' | 'generous' | 'auto' = 'auto';
  if (budget === 'conservative' || budget === 'balanced' || budget === 'generous') {
    budgetOverride = budget;
  }

  return { enabled, budgetOverride };
}

// ─── ZERO-RESULT FALLBACK ─────────────────────────────────────

function searchWithFallback(
  index: ReturnType<typeof getOrBuildIndex>,
  analyzedQuery: AnalyzedQuery,
): SearchResult[] {
  // First attempt: full query
  let results = searchIndex(index, analyzedQuery, {
    topK: 15,
    minScore: 0.1,
    methodFilter: analyzedQuery.methodHint,
    boostEntityTerms: true,
  });

  if (results.length > 0) { return results; }

  // Second attempt: entity terms only (drop verbs and common words)
  if (analyzedQuery.entityTerms.length > 0) {
    const entityOnlyQuery: AnalyzedQuery = {
      ...analyzedQuery,
      keywords: analyzedQuery.entityTerms,
      methodHint: 'any',
    };
    results = searchIndex(index, entityOnlyQuery, {
      topK: 15,
      minScore: 0.05,
      boostEntityTerms: true,
    });
    if (results.length > 0) { return results; }
  }

  // Third attempt: just the first keyword
  if (analyzedQuery.keywords.length > 0) {
    const singleKeywordQuery: AnalyzedQuery = {
      ...analyzedQuery,
      keywords: [analyzedQuery.keywords[0]],
      entityTerms: [],
      methodHint: 'any',
    };
    results = searchIndex(index, singleKeywordQuery, {
      topK: 15,
      minScore: 0.01,
    });
    if (results.length > 0) { return results; }
  }

  // All attempts failed — return empty, caller will send global summary
  return [];
}

// ─── SERVICE CLASS ────────────────────────────────────────────

export class SmartContextService {
  private currentCollection: ParsedCollection | null = null;
  private fullCollectionMarkdown: string | null = null;

  setCollection(collection: ParsedCollection): void {
    this.currentCollection = collection;
    this.fullCollectionMarkdown = null;
    // Pre-build the index asynchronously
    setTimeout(() => {
      getOrBuildIndex(collection);
      console.log(
        `[Postchat] Index built for "${collection.title}" ` +
        `(${collection.endpoints.length} endpoints)`,
      );
    }, 0);
  }

  clearCollection(): void {
    if (this.currentCollection) {
      invalidateIndex(this.currentCollection.title);
    }
    this.currentCollection = null;
    this.fullCollectionMarkdown = null;
  }

  getContextForQuery(
    userMessage: string,
    conversationHistory: { role: string; content: string }[],
  ): ContextFilterResult {
    if (!this.currentCollection) {
      throw new Error('No collection loaded');
    }

    const startTime = Date.now();
    const collection = this.currentCollection;
    const settings = readFilterSettings();

    // ── Context Gate: decide if context is needed at all ──
    const gateDecision = shouldSendContext(userMessage, conversationHistory);

    if (gateDecision === 'none') {
      console.log('[Postchat] Context gate: none — skipping collection context');
      return {
        contextMarkdown: '',
        analyzedQuery: null,
        stats: {
          totalEndpoints: collection.endpoints.length,
          sentFull: 0,
          sentSummary: 0,
          excluded: collection.endpoints.length,
          estimatedInputTokens: 0,
          estimatedCostSavingPercent: 100,
          processingTimeMs: Date.now() - startTime,
          budgetMode: 'none',
          gateDecision: 'none',
        },
      };
    }

    if (gateDecision === 'history') {
      console.log('[Postchat] Context gate: history — using conversation context only');
      const historyContext = buildHistoryOnlyContext(conversationHistory, collection);
      return {
        contextMarkdown: historyContext.markdown,
        analyzedQuery: null,
        stats: {
          totalEndpoints: collection.endpoints.length,
          sentFull: 0,
          sentSummary: historyContext.matchedEndpoints,
          excluded: collection.endpoints.length - historyContext.matchedEndpoints,
          estimatedInputTokens: estimateTokens(historyContext.markdown),
          estimatedCostSavingPercent: 100,
          processingTimeMs: Date.now() - startTime,
          budgetMode: 'history',
          gateDecision: 'history',
        },
      };
    }

    // ── Setting: filter disabled → send full collection ──
    if (!settings.enabled) {
      const markdown = this.getFullCollectionMarkdown();
      return this.buildDisabledResult(markdown, userMessage, startTime);
    }

    // ── Small collection shortcut (<10 endpoints) ──
    if (collection.endpoints.length < SMALL_COLLECTION_THRESHOLD) {
      console.log('[Postchat] Small collection (<10 endpoints) — skipping filter');
      const markdown = this.getFullCollectionMarkdown();
      return this.buildDisabledResult(markdown, userMessage, startTime);
    }

    // ── Very long user message → extract searchable fragment ──
    const searchMessage = extractSearchableFragment(userMessage);

    // Step 1: Analyze the query
    const analyzedQuery = analyzeQuery(searchMessage);

    // Step 2: Determine budget mode
    let budgetMode: 'conservative' | 'balanced' | 'generous';
    if (settings.budgetOverride !== 'auto') {
      budgetMode = settings.budgetOverride;
    } else {
      budgetMode = determineBudgetMode(analyzedQuery, conversationHistory);
    }

    // Step 3: Get the BM25 index
    const index = getOrBuildIndex(collection);

    // Step 4: Check for follow-up queries
    const isFollowUp = isFollowUpQuery(searchMessage, conversationHistory);

    // Step 5: Search the index (with fallback for zero results)
    let searchResults: SearchResult[];
    if (analyzedQuery.isGlobalQuery) {
      searchResults = [];
    } else {
      searchResults = searchWithFallback(index, analyzedQuery);
    }

    // Step 6: Boost previously-mentioned endpoints for continuity
    const mentionedIds = extractMentionedEndpoints(conversationHistory, collection);
    searchResults = boostMentionedEndpoints(searchResults, mentionedIds);

    // Step 7: Handle follow-up — merge previous endpoint into results
    if (isFollowUp) {
      const lastEndpoint = getLastDiscussedEndpoint(conversationHistory, collection);
      if (lastEndpoint) {
        searchResults = mergeFollowUpResults(lastEndpoint, searchResults);
      }
    }

    // Re-sort after boosts and merges
    searchResults.sort((a, b) => b.score - a.score);

    // Step 8: Build the tiered context
    const builtContext = buildContext({
      query: analyzedQuery,
      searchResults,
      collection,
      budgetMode,
    });

    // Step 9: Calculate savings
    const fullCollectionTokens = estimateTokens(
      collection.endpoints.map(e => e.name + e.path + (e.description || '')).join(' '),
    ) * 3;

    const savingPercent = fullCollectionTokens > 0
      ? Math.round((1 - builtContext.totalEstimatedTokens / fullCollectionTokens) * 100)
      : 0;

    const processingTimeMs = Date.now() - startTime;

    return {
      contextMarkdown: builtContext.markdown,
      analyzedQuery,
      stats: {
        totalEndpoints: collection.endpoints.length,
        sentFull: builtContext.endpointsCounts.fullDetail,
        sentSummary: builtContext.endpointsCounts.summary,
        excluded: builtContext.endpointsCounts.excluded,
        estimatedInputTokens: builtContext.totalEstimatedTokens,
        estimatedCostSavingPercent: Math.max(0, savingPercent),
        processingTimeMs,
        budgetMode,
        gateDecision: 'filter',
      },
    };
  }

  debugQuery(userMessage: string): {
    analysis: AnalyzedQuery;
    topResults: SearchResult[];
  } {
    const collection = this.currentCollection;
    if (!collection) { throw new Error('No collection loaded'); }
    const analysis = analyzeQuery(userMessage);
    const index = getOrBuildIndex(collection);
    const topResults = searchIndex(index, analysis, { topK: 10, minScore: 0 });
    return { analysis, topResults };
  }

  // ─── PRIVATE HELPERS ──────────────────────────────────────────

  private getFullCollectionMarkdown(): string {
    if (!this.currentCollection) { return ''; }
    if (!this.fullCollectionMarkdown) {
      this.fullCollectionMarkdown = collectionToMarkdown(this.currentCollection);
    }
    return this.fullCollectionMarkdown;
  }

  private buildDisabledResult(
    markdown: string,
    userMessage: string,
    startTime: number,
  ): ContextFilterResult {
    const collection = this.currentCollection!;
    return {
      contextMarkdown: markdown,
      analyzedQuery: analyzeQuery(userMessage),
      stats: {
        totalEndpoints: collection.endpoints.length,
        sentFull: collection.endpoints.length,
        sentSummary: 0,
        excluded: 0,
        estimatedInputTokens: estimateTokens(markdown),
        estimatedCostSavingPercent: 0,
        processingTimeMs: Date.now() - startTime,
        budgetMode: 'full',
        gateDecision: 'filter',
      },
    };
  }
}
