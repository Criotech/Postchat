import type { ParsedEndpoint, ParsedCollection } from '../specParser/types';
import type { AnalyzedQuery } from './queryAnalyzer';
import type { SearchResult } from './bm25Index';

// ─── TOKEN BUDGET CONSTANTS ───────────────────────────────────

const TOKEN_BUDGETS = {
  conservative: 2000,
  balanced: 4000,
  generous: 8000,

  fullDetail: 400,
  summary: 60,
  nameOnly: 20,
};

const TIER_THRESHOLDS = {
  fullDetail: 0.8,
  summary: 0.3,
};

const MAX_ENDPOINTS_PER_TIER = {
  fullDetail: 5,
  summary: 10,
};

// ─── TYPES ─────────────────────────────────────────────────────

type ContextTier = 'full' | 'summary' | 'excluded';

type TieredEndpoint = {
  endpoint: ParsedEndpoint;
  tier: ContextTier;
  score: number;
  estimatedTokens: number;
};

export type BuiltContext = {
  markdown: string;
  totalEstimatedTokens: number;
  endpointsCounts: {
    total: number;
    fullDetail: number;
    summary: number;
    excluded: number;
  };
  budget: keyof typeof TOKEN_BUDGETS;
  isGlobalContext: boolean;
  truncated: boolean;
};

// ─── TOKEN ESTIMATOR ──────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── TIER ASSIGNMENT ──────────────────────────────────────────

function assignTiers(
  results: SearchResult[],
  totalEndpoints: number,
  query: AnalyzedQuery,
): TieredEndpoint[] {
  if (results.length === 0) { return []; }

  const maxScore = results[0].score;

  // Single-endpoint high-confidence shortcut
  if (query.isSingleEndpointQuery && results.length > 0 && results[0].score / maxScore > 0.9) {
    return [
      {
        endpoint: results[0].endpoint,
        tier: 'full' as ContextTier,
        score: results[0].score,
        estimatedTokens: TOKEN_BUDGETS.fullDetail,
      },
      ...results.slice(1).map(r => ({
        endpoint: r.endpoint,
        tier: 'excluded' as ContextTier,
        score: r.score,
        estimatedTokens: 0,
      })),
    ];
  }

  // List endpoints intent: everything goes to summary
  if (query.intent === 'list_endpoints') {
    return results.slice(0, MAX_ENDPOINTS_PER_TIER.fullDetail + MAX_ENDPOINTS_PER_TIER.summary).map(r => ({
      endpoint: r.endpoint,
      tier: 'summary' as ContextTier,
      score: r.score,
      estimatedTokens: TOKEN_BUDGETS.summary,
    }));
  }

  // Standard tier assignment
  const tiered: TieredEndpoint[] = [];
  let fullCount = 0;
  let summaryCount = 0;

  const capped = results.slice(0, MAX_ENDPOINTS_PER_TIER.fullDetail + MAX_ENDPOINTS_PER_TIER.summary);

  for (const r of capped) {
    const normScore = r.score / maxScore;

    if (fullCount < MAX_ENDPOINTS_PER_TIER.fullDetail && normScore >= TIER_THRESHOLDS.fullDetail) {
      tiered.push({
        endpoint: r.endpoint,
        tier: 'full',
        score: r.score,
        estimatedTokens: TOKEN_BUDGETS.fullDetail,
      });
      fullCount++;
    } else if (summaryCount < MAX_ENDPOINTS_PER_TIER.summary && normScore >= TIER_THRESHOLDS.summary) {
      tiered.push({
        endpoint: r.endpoint,
        tier: 'summary',
        score: r.score,
        estimatedTokens: TOKEN_BUDGETS.summary,
      });
      summaryCount++;
    } else {
      tiered.push({
        endpoint: r.endpoint,
        tier: 'excluded',
        score: r.score,
        estimatedTokens: 0,
      });
    }
  }

  // Auth intent: promote auth-related endpoints
  if (query.intent === 'understand_auth') {
    let authFullCount = 0;
    for (const item of tiered) {
      if (item.endpoint.requiresAuth || item.endpoint.authType) {
        if (authFullCount < 3 && item.tier !== 'full') {
          item.tier = 'full';
          item.estimatedTokens = TOKEN_BUDGETS.fullDetail;
          authFullCount++;
        } else if (item.tier === 'excluded') {
          item.tier = 'summary';
          item.estimatedTokens = TOKEN_BUDGETS.summary;
        }
      }
      if (item.tier === 'full' && (item.endpoint.requiresAuth || item.endpoint.authType)) {
        authFullCount++;
      }
    }
  }

  return tiered;
}

// ─── CONTEXT FORMATTERS ───────────────────────────────────────

function formatEndpointFull(endpoint: ParsedEndpoint): string {
  const lines: string[] = [];

  lines.push(`### ${endpoint.method} ${endpoint.name}`);
  lines.push(`- **URL:** \`${endpoint.url}\``);
  lines.push(`- **Description:** ${endpoint.description || 'No description'}`);

  // Parameters
  if (endpoint.parameters.length > 0) {
    lines.push('- **Parameters:**');
    for (const p of endpoint.parameters) {
      const req = p.required ? ', required' : '';
      const desc = p.description ? ` — ${p.description}` : '';
      lines.push(`  - \`${p.name}\` (${p.location}, ${p.type}${req})${desc}`);
    }
  }

  // Headers
  const enabledHeaders = endpoint.headers.filter(h => h.enabled);
  if (enabledHeaders.length > 0) {
    const headerStr = enabledHeaders.map(h => `${h.key}: ${h.value}`).join(', ');
    lines.push(`- **Headers:** ${headerStr}`);
  }

  // Request body
  if (endpoint.requestBody) {
    const contentType = endpoint.requestContentType || 'application/json';
    const truncatedBody = endpoint.requestBody.length > 300
      ? endpoint.requestBody.slice(0, 300) + '...'
      : endpoint.requestBody;
    lines.push(`- **Request Body** (${contentType}):`);
    lines.push('```json');
    lines.push(truncatedBody);
    lines.push('```');
  }

  // Responses
  if (endpoint.responses.length > 0) {
    const respParts = endpoint.responses.map(r => `${r.statusCode}: ${r.description}`);
    lines.push(`- **Responses:** ${respParts.join('; ')}`);
  }

  // Auth
  if (endpoint.requiresAuth) {
    lines.push(`- **Auth Required:** Yes${endpoint.authType ? ` (${endpoint.authType})` : ''}`);
  } else {
    lines.push('- **Auth Required:** No');
  }

  return lines.join('\n');
}

function formatEndpointSummary(endpoint: ParsedEndpoint): string {
  let line = `\`${endpoint.method} ${endpoint.path}\` — ${endpoint.name}`;
  if (endpoint.description) {
    line += ': ' + endpoint.description.slice(0, 80);
    if (endpoint.description.length > 80) {
      line += '...';
    }
  }
  return line;
}

function formatGlobalSummary(collection: ParsedCollection): string {
  const lines: string[] = [];

  lines.push(`# ${collection.title} API`);
  lines.push(`Base URL: \`${collection.baseUrl}\``);

  // Count unique folders
  const folderMap = new Map<string, ParsedEndpoint[]>();
  for (const ep of collection.endpoints) {
    const folder = ep.folder || 'Ungrouped';
    const list = folderMap.get(folder);
    if (list) {
      list.push(ep);
    } else {
      folderMap.set(folder, [ep]);
    }
  }

  lines.push(`Total Endpoints: ${collection.endpoints.length} across ${folderMap.size} groups`);

  // Auth schemes summary
  if (collection.authSchemes.length > 0) {
    const schemes = collection.authSchemes.map(a => `${a.type} (${a.name})`).join(', ');
    lines.push(`Authentication: ${schemes}`);
  } else {
    lines.push('Authentication: None');
  }

  lines.push('');
  lines.push('## Endpoint Index');

  // Group endpoints by folder
  folderMap.forEach((endpoints, folder) => {
    lines.push(`### ${folder} (${endpoints.length} endpoints)`);
    for (const ep of endpoints) {
      lines.push(`${ep.method} \`${ep.path}\` — ${ep.name}`);
    }
    lines.push('');
  });

  lines.push('> This is a compact index. Ask about specific endpoints for full details.');

  return lines.join('\n');
}

// ─── MAIN BUILDER ─────────────────────────────────────────────

export function buildContext(params: {
  query: AnalyzedQuery;
  searchResults: SearchResult[];
  collection: ParsedCollection;
  budgetMode?: 'conservative' | 'balanced' | 'generous';
}): BuiltContext {
  const { query, searchResults, collection, budgetMode = 'balanced' } = params;
  const tokenBudget = TOKEN_BUDGETS[budgetMode];

  // Global query: user wants an overview of the whole collection
  if (query.isGlobalQuery) {
    const markdown = formatGlobalSummary(collection);
    return {
      markdown,
      totalEstimatedTokens: estimateTokens(markdown),
      endpointsCounts: {
        total: collection.endpoints.length,
        fullDetail: 0,
        summary: collection.endpoints.length,
        excluded: 0,
      },
      budget: budgetMode,
      isGlobalContext: true,
      truncated: false,
    };
  }

  // No results from search: fall back to global summary
  if (searchResults.length === 0) {
    return buildContext({ ...params, query: { ...query, isGlobalQuery: true } });
  }

  // Assign tiers to search results
  const tiered = assignTiers(searchResults, collection.endpoints.length, query);

  // Build the context string respecting the token budget
  const sections: string[] = [];
  let usedTokens = 0;
  let truncated = false;
  const counts = { total: collection.endpoints.length, fullDetail: 0, summary: 0, excluded: 0 };

  // Collection header (always included)
  const authSummary = collection.authSchemes.length > 0
    ? collection.authSchemes.map(a => a.type).join(', ')
    : 'None';
  const relevantCount = tiered.filter(t => t.tier !== 'excluded').length;
  const header = [
    `# ${collection.title} API`,
    `Base URL: \`${collection.baseUrl}\``,
    `Auth: ${authSummary}`,
    '',
    `> Context: ${relevantCount} of ${collection.endpoints.length} endpoints shown (filtered by relevance)`,
    '',
  ].join('\n');

  sections.push(header);
  usedTokens += estimateTokens(header);

  // Full detail endpoints first
  const fullItems = tiered.filter(t => t.tier === 'full');
  for (const item of fullItems) {
    if (usedTokens + item.estimatedTokens > tokenBudget) {
      truncated = true;
      // Downgrade to summary instead of excluding
      const summary = formatEndpointSummary(item.endpoint);
      sections.push(summary);
      usedTokens += TOKEN_BUDGETS.summary;
      counts.summary++;
      continue;
    }
    sections.push(formatEndpointFull(item.endpoint));
    usedTokens += item.estimatedTokens;
    counts.fullDetail++;
  }

  // Summary endpoints
  const summaryItems = tiered.filter(t => t.tier === 'summary');
  if (summaryItems.length > 0 && usedTokens < tokenBudget) {
    const summaryHeader = '\n## Related Endpoints (Summary)\n';
    sections.push(summaryHeader);
    usedTokens += estimateTokens(summaryHeader);

    for (const item of summaryItems) {
      if (usedTokens + TOKEN_BUDGETS.summary > tokenBudget) {
        truncated = true;
        break;
      }
      sections.push(formatEndpointSummary(item.endpoint));
      usedTokens += TOKEN_BUDGETS.summary;
      counts.summary++;
    }
  }

  counts.excluded = collection.endpoints.length - counts.fullDetail - counts.summary;

  // Footer note so the LLM knows context was filtered
  if (counts.excluded > 0) {
    const footer = `\n> ${counts.excluded} additional endpoints not shown. Ask specifically about them if needed.`;
    sections.push(footer);
  }

  return {
    markdown: sections.join('\n'),
    totalEstimatedTokens: usedTokens,
    endpointsCounts: counts,
    budget: budgetMode,
    isGlobalContext: false,
    truncated,
  };
}
