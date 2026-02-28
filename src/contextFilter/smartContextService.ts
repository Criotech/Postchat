import type { ParsedCollection } from '../specParser/types';
import { analyzeQuery, type AnalyzedQuery } from './queryAnalyzer';
import { getOrBuildIndex, searchIndex, invalidateIndex, type SearchResult } from './bm25Index';
import { buildContext, estimateTokens } from './contextBuilder';

export type ContextFilterStats = {
  totalEndpoints: number;
  sentFull: number;
  sentSummary: number;
  excluded: number;
  estimatedInputTokens: number;
  estimatedCostSavingPercent: number;
  processingTimeMs: number;
  budgetMode: string;
};

export type ContextFilterResult = {
  contextMarkdown: string;
  analyzedQuery: AnalyzedQuery;
  stats: ContextFilterStats;
};

function determineBudgetMode(
  query: AnalyzedQuery,
  _history: { role: string; content: string }[],
): 'conservative' | 'balanced' | 'generous' {
  // Generous: complex queries that likely need more context
  if (query.isGlobalQuery) { return 'generous'; }
  if (query.intent === 'compare_endpoints') { return 'generous'; }
  if (query.intent === 'understand_auth') { return 'generous'; }

  // Conservative: highly specific single-endpoint queries
  if (query.isSingleEndpointQuery) { return 'conservative'; }
  if (query.intent === 'run_request') { return 'conservative'; }

  // Balanced: everything else
  return 'balanced';
}

export class SmartContextService {
  private currentCollection: ParsedCollection | null = null;

  setCollection(collection: ParsedCollection): void {
    this.currentCollection = collection;
    // Pre-build the index immediately on collection load.
    // Uses setTimeout so it doesn't block the caller.
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

    // Step 1: Analyze the query
    const analyzedQuery = analyzeQuery(userMessage);

    // Step 2: Determine budget mode based on query complexity
    const budgetMode = determineBudgetMode(analyzedQuery, conversationHistory);

    // Step 3: Get or build the BM25 index (from cache if available)
    const index = getOrBuildIndex(collection);

    // Step 4: Search the index
    const searchResults = analyzedQuery.isGlobalQuery
      ? []
      : searchIndex(index, analyzedQuery, {
          topK: 15,
          minScore: 0.1,
          methodFilter: analyzedQuery.methodHint,
          boostEntityTerms: true,
        });

    // Step 5: Build the tiered context
    const builtContext = buildContext({
      query: analyzedQuery,
      searchResults,
      collection,
      budgetMode,
    });

    // Step 6: Calculate savings vs full collection
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
}
