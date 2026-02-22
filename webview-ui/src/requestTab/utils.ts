import type { ParsedEndpoint } from "../types/spec";
import type { KeyValueRow, RequestEditState } from "./types";

export const METHOD_COLORS: Record<string, string> = {
  GET: "#3B82F6",
  POST: "#22C55E",
  PUT: "#F97316",
  PATCH: "#EAB308",
  DELETE: "#EF4444",
  HEAD: "#14B8A6",
  OPTIONS: "#8B5CF6"
};

export function replaceEnvironmentVars(
  value: string,
  environment: Record<string, string>
): string {
  return value.replace(/{{\s*([^{}\s]+)\s*}}/g, (_match, key: string) => {
    const replacement = environment[key];
    return replacement ?? `{{${key}}}`;
  });
}

export function parseUrlTokens(url: string): string[] {
  const keys = new Set<string>();
  const regex = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(url)) !== null) {
    const key = match[1]?.trim();
    if (key) {
      keys.add(key);
    }
  }

  return [...keys.values()];
}

export function parseQueryRows(url: string): KeyValueRow[] {
  try {
    const parsed = new URL(url);
    const rows: KeyValueRow[] = [];
    parsed.searchParams.forEach((value, key) => {
      rows.push({ key, value, enabled: true });
    });
    return rows;
  } catch {
    const queryIndex = url.indexOf("?");
    if (queryIndex < 0) {
      return [];
    }

    const raw = url.slice(queryIndex + 1);
    const params = new URLSearchParams(raw);
    const rows: KeyValueRow[] = [];
    params.forEach((value, key) => {
      rows.push({ key, value, enabled: true });
    });
    return rows;
  }
}

export function splitUrl(url: string): { basePath: string; query: string } {
  const queryIndex = url.indexOf("?");
  if (queryIndex < 0) {
    return { basePath: url, query: "" };
  }

  return {
    basePath: url.slice(0, queryIndex),
    query: url.slice(queryIndex + 1)
  };
}

export function buildUrlFromState(
  urlTemplate: string,
  pathParams: Record<string, string>,
  queryParams: KeyValueRow[]
): string {
  const { basePath } = splitUrl(urlTemplate);
  const withPathParams = basePath.replace(/\{([^{}]+)\}/g, (_match, token: string) => {
    const key = token.trim();
    const replacement = pathParams[key];
    return encodeURIComponent(replacement ?? "");
  });

  const search = new URLSearchParams();
  for (const row of queryParams) {
    if (!row.enabled || !row.key.trim()) {
      continue;
    }
    search.append(row.key.trim(), row.value);
  }

  const query = search.toString();
  return query ? `${withPathParams}?${query}` : withPathParams;
}

export function initPathParams(endpoint: ParsedEndpoint, resolvedUrl: string): Record<string, string> {
  const tokenKeys = parseUrlTokens(endpoint.url);
  const pathValues = endpoint.parameters
    .filter((param) => param.location === "path")
    .reduce<Record<string, string>>((acc, param) => {
      acc[param.name] = param.example?.trim() || "";
      return acc;
    }, {});

  try {
    const originalPath = new URL(endpoint.url).pathname;
    const resolvedPath = new URL(resolvedUrl).pathname;
    const originalParts = originalPath.split("/").filter(Boolean);
    const resolvedParts = resolvedPath.split("/").filter(Boolean);

    for (let index = 0; index < originalParts.length; index += 1) {
      const part = originalParts[index] ?? "";
      if (!(part.startsWith("{") && part.endsWith("}"))) {
        continue;
      }

      const key = part.slice(1, -1).trim();
      if (!key) {
        continue;
      }

      pathValues[key] = decodeURIComponent(resolvedParts[index] ?? pathValues[key] ?? "");
    }
  } catch {
    // Fall back to endpoint metadata only.
  }

  for (const key of tokenKeys) {
    if (!(key in pathValues)) {
      pathValues[key] = "";
    }
  }

  return pathValues;
}

export function inferContentType(headers: KeyValueRow[], fallback?: string): string {
  const fromHeaders = headers.find((header) => header.key.toLowerCase() === "content-type")?.value;
  const value = (fromHeaders ?? fallback ?? "").toLowerCase();

  if (value.includes("application/json")) {
    return "json";
  }
  if (value.includes("multipart/form-data")) {
    return "form-data";
  }
  if (value.includes("application/x-www-form-urlencoded")) {
    return "urlencoded";
  }
  if (value.includes("text/plain")) {
    return "raw";
  }
  if (value.includes("application/octet-stream")) {
    return "binary";
  }
  return "none";
}

export function buildInitialEditState(
  endpoint: ParsedEndpoint,
  environment: Record<string, string>
): { state: RequestEditState; urlTemplate: string } {
  const templateUrl = replaceEnvironmentVars(endpoint.url, environment);
  const queryFromEndpoint = endpoint.parameters
    .filter((param) => param.location === "query")
    .map((param) => ({
      key: param.name,
      value: param.example?.trim() || "",
      enabled: param.required
    }));

  const baseHeaders: KeyValueRow[] = endpoint.headers.map((header) => ({
    key: header.key,
    value: replaceEnvironmentVars(header.value, environment),
    enabled: header.enabled
  }));

  const contentType = inferContentType(baseHeaders, endpoint.requestContentType);
  const queryParamsFromUrl = parseQueryRows(templateUrl);
  const queryParams = mergeQueryRows(queryParamsFromUrl, queryFromEndpoint);
  const pathParams = initPathParams(endpoint, templateUrl);
  const resolvedUrl = buildUrlFromState(templateUrl, pathParams, queryParams);

  return {
    urlTemplate: templateUrl,
    state: {
      method: endpoint.method,
      url: resolvedUrl,
      pathParams,
      queryParams,
      headers: baseHeaders,
      body: replaceEnvironmentVars(endpoint.requestBody ?? "", environment),
      contentType,
      authType: normalizeAuthType(endpoint.authType),
      authValue: ""
    }
  };
}

function mergeQueryRows(primary: KeyValueRow[], secondary: KeyValueRow[]): KeyValueRow[] {
  const rows = [...primary];
  for (const row of secondary) {
    if (!row.key.trim()) {
      continue;
    }

    const existing = rows.find((candidate) => candidate.key === row.key);
    if (!existing) {
      rows.push(row);
      continue;
    }

    if (!existing.value && row.value) {
      existing.value = row.value;
    }
    existing.enabled = existing.enabled || row.enabled;
  }

  return rows;
}

function normalizeAuthType(authType?: string): string {
  const normalized = (authType ?? "none").toLowerCase();
  if (normalized === "bearer" || normalized === "apikey" || normalized === "basic") {
    return normalized;
  }
  if (normalized === "oauth2") {
    return "oauth2";
  }
  return "none";
}

export function upsertHeader(rows: KeyValueRow[], key: string, value: string): KeyValueRow[] {
  const next = [...rows];
  const existing = next.find((row) => row.key.toLowerCase() === key.toLowerCase());
  if (existing) {
    existing.value = value;
    existing.enabled = true;
    return next;
  }

  next.push({ key, value, enabled: true });
  return next;
}

export function removeHeader(rows: KeyValueRow[], key: string): KeyValueRow[] {
  return rows.filter((row) => row.key.toLowerCase() !== key.toLowerCase());
}

export function upsertQuery(rows: KeyValueRow[], key: string, value: string): KeyValueRow[] {
  const next = [...rows];
  const existing = next.find((row) => row.key === key);
  if (existing) {
    existing.value = value;
    existing.enabled = true;
    return next;
  }

  next.push({ key, value, enabled: true });
  return next;
}

export function removeQuery(rows: KeyValueRow[], key: string): KeyValueRow[] {
  return rows.filter((row) => row.key !== key);
}

export function bytesToKb(value: string): number {
  const bytes = new TextEncoder().encode(value).length;
  return Math.round((bytes / 1024) * 100) / 100;
}
