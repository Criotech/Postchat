import * as fs from "node:fs/promises";
import type {
  ParsedCollection,
  ParsedEndpoint,
  ParsedHeader,
  ParsedParameter,
  ParsedResponse
} from "./types";

type PostmanVariable = {
  key?: string;
  value?: unknown;
};

type PostmanAuth = {
  type?: string;
  [key: string]: unknown;
};

type PostmanHeader = {
  key?: string;
  value?: string;
  enabled?: boolean;
  disabled?: boolean;
};

type PostmanQuery = {
  key?: string;
  value?: string;
  disabled?: boolean;
  description?: string;
};

type PostmanBody = {
  mode?: "raw" | "urlencoded" | "formdata" | string;
  raw?: string;
  urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  formdata?: Array<{ key?: string; value?: string; disabled?: boolean }>;
};

type PostmanUrl =
  | string
  | {
      raw?: string;
      host?: string[];
      protocol?: string;
      path?: string[];
      query?: PostmanQuery[];
    };

type PostmanRequest = {
  method?: string;
  description?: string | { content?: string };
  url?: PostmanUrl;
  header?: PostmanHeader[];
  body?: PostmanBody;
  auth?: PostmanAuth;
};

type PostmanResponse = {
  name?: string;
  status?: string;
  code?: number;
  body?: string;
};

type PostmanItem = {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  response?: PostmanResponse[];
};

type PostmanCollection = {
  info?: {
    name?: string;
    description?: string | { content?: string };
    version?: string | { major?: number; minor?: number; patch?: number };
  };
  variable?: PostmanVariable[];
  item?: PostmanItem[];
  auth?: PostmanAuth;
};
type PostmanVersion =
  | string
  | {
      major?: number;
      minor?: number;
      patch?: number;
    };

const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS"
]);

export async function parsePostman(filePath: string): Promise<ParsedCollection> {
  const content = await readFileOrThrow(filePath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Invalid JSON in collection file. Check the file is valid JSON.");
  }

  if (!isObject(parsed)) {
    throw new Error("Invalid JSON in collection file. Check the file is valid JSON.");
  }

  const collection = parsed as PostmanCollection;
  const collectionVariables = toVariableMap(collection.variable);
  const collectionAuthType = typeof collection.auth?.type === "string" ? collection.auth.type : undefined;
  const baseUrl =
    getBaseUrlFromVariables(collectionVariables) ||
    getBaseUrlFromFirstRequest(collection.item) ||
    "";

  const endpoints = walkItems(
    collection.item ?? [],
    baseUrl,
    collectionVariables,
    collectionAuthType,
    "General"
  );

  const authSchemes = extractCollectionAuthSchemes(collection.auth);

  return {
    specType: "postman",
    title: cleanText(collection.info?.name) || "Untitled Collection",
    version: getVersion(collection.info?.version),
    baseUrl,
    description: getDescription(collection.info?.description),
    endpoints,
    authSchemes
  };
}

function walkItems(
  items: PostmanItem[],
  baseUrl: string,
  variables: Record<string, string>,
  collectionAuthType?: string,
  folderName = "General"
): ParsedEndpoint[] {
  const endpoints: ParsedEndpoint[] = [];

  for (const item of items) {
    if (Array.isArray(item.item) && item.item.length > 0) {
      const nestedFolder = cleanText(item.name) || folderName;
      endpoints.push(
        ...walkItems(item.item, baseUrl, variables, collectionAuthType, nestedFolder)
      );
      continue;
    }

    if (!item.request) {
      continue;
    }

    const method = toAllowedMethod(item.request.method);
    const resolvedUrl = resolvePostmanUrl(item.request.url, variables, baseUrl);
    const path = extractPath(resolvedUrl);
    const description = getDescription(item.request.description);
    const headers = extractHeaders(item.request.header, variables);
    const parameters = extractQueryParameters(item.request.url, variables);
    const { requestBody, requestContentType } = extractBody(item.request.body, headers, variables);
    const responses = extractResponses(item.response);
    const requestAuthType = typeof item.request.auth?.type === "string" ? item.request.auth.type : undefined;
    const authType = requestAuthType ?? collectionAuthType;
    const requiresAuth =
      Boolean(requestAuthType) ||
      headers.some((header) => header.key.toLowerCase() === "authorization") ||
      Boolean(collectionAuthType);

    const endpointUrl = resolvedUrl || `${baseUrl}${path}`;
    const endpointName = cleanText(item.name) || `${method} ${path || endpointUrl || "endpoint"}`;

    endpoints.push({
      id: hashString(`${method}:${endpointUrl || path}`),
      name: endpointName,
      method,
      url: endpointUrl,
      path,
      folder: folderName,
      description,
      headers,
      parameters,
      requestBody,
      requestContentType,
      responses,
      requiresAuth,
      authType
    });
  }

  return endpoints;
}

function extractHeaders(headers: PostmanHeader[] | undefined, variables: Record<string, string>): ParsedHeader[] {
  return (headers ?? [])
    .filter((header) => {
      const enabled = header.enabled ?? !header.disabled;
      return Boolean(header.key) && enabled;
    })
    .map((header) => ({
      key: header.key?.trim() ?? "",
      value: resolveVariables(header.value ?? "", variables),
      enabled: true
    }))
    .filter((header) => Boolean(header.key));
}

function extractQueryParameters(url: PostmanUrl | undefined, variables: Record<string, string>): ParsedParameter[] {
  if (!url || typeof url === "string") {
    return [];
  }

  const queryParams = url.query ?? [];
  return queryParams
    .filter((param) => !param.disabled && Boolean(param.key))
    .map((param) => ({
      name: param.key?.trim() ?? "",
      location: "query" as const,
      required: false,
      type: "string",
      description: cleanText(param.description),
      example: resolveVariables(param.value ?? "", variables) || undefined
    }))
    .filter((param) => Boolean(param.name));
}

function extractBody(
  body: PostmanBody | undefined,
  headers: ParsedHeader[],
  variables: Record<string, string>
): { requestBody?: string; requestContentType?: string } {
  if (!body || !body.mode) {
    return {
      requestContentType: getContentType(headers)
    };
  }

  if (body.mode === "raw") {
    return {
      requestBody: resolveVariables(body.raw ?? "", variables),
      requestContentType: getContentType(headers) || "application/json"
    };
  }

  if (body.mode === "urlencoded") {
    const encoded = (body.urlencoded ?? [])
      .filter((entry) => !entry.disabled && entry.key)
      .map((entry) => `${entry.key}=${resolveVariables(entry.value ?? "", variables)}`)
      .join("&");

    return {
      requestBody: encoded || undefined,
      requestContentType: getContentType(headers) || "application/x-www-form-urlencoded"
    };
  }

  if (body.mode === "formdata") {
    const keys = (body.formdata ?? [])
      .filter((entry) => !entry.disabled && entry.key)
      .map((entry) => entry.key?.trim())
      .filter((key): key is string => Boolean(key));

    return {
      requestBody: keys.length > 0 ? `form-data keys: ${keys.join(", ")}` : undefined,
      requestContentType: getContentType(headers) || "multipart/form-data"
    };
  }

  return {
    requestContentType: getContentType(headers)
  };
}

function extractResponses(responses: PostmanResponse[] | undefined): ParsedResponse[] {
  return (responses ?? []).map((response) => ({
    statusCode: response.code ? String(response.code) : cleanText(response.status) || "unknown",
    description: cleanText(response.status) || cleanText(response.name) || "",
    example: cleanText(response.body) || undefined
  }));
}

function resolvePostmanUrl(
  url: PostmanUrl | undefined,
  variables: Record<string, string>,
  baseUrl: string
): string {
  if (!url) {
    return "";
  }

  if (typeof url === "string") {
    return resolveVariables(url, variables);
  }

  const raw = resolveVariables(url.raw ?? "", variables);
  if (raw) {
    return raw;
  }

  const host = Array.isArray(url.host) ? url.host.join(".") : "";
  const protocol = cleanText(url.protocol) || "https";
  const path = Array.isArray(url.path) ? `/${url.path.join("/")}` : "";
  if (host) {
    return `${protocol}://${host}${path}`;
  }

  if (path) {
    return baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path;
  }

  return "";
}

function extractPath(fullUrl: string): string {
  if (!fullUrl) {
    return "";
  }

  if (fullUrl.startsWith("/")) {
    return fullUrl;
  }

  try {
    const parsed = new URL(fullUrl);
    return parsed.pathname || "/";
  } catch {
    const withoutHost = fullUrl.replace(/^[a-zA-Z]+:\/\/[^/]+/, "");
    if (withoutHost.startsWith("/")) {
      return withoutHost.split("?")[0] ?? "";
    }
    return withoutHost || "";
  }
}

function getBaseUrlFromVariables(variables: Record<string, string>): string {
  return variables.baseUrl || variables.base_url || "";
}

function getBaseUrlFromFirstRequest(items: PostmanItem[] | undefined): string {
  if (!items) {
    return "";
  }

  for (const item of items) {
    if (Array.isArray(item.item) && item.item.length > 0) {
      const nested = getBaseUrlFromFirstRequest(item.item);
      if (nested) {
        return nested;
      }
      continue;
    }

    const requestUrl = item.request?.url;
    if (!requestUrl) {
      continue;
    }

    const raw = typeof requestUrl === "string" ? requestUrl : requestUrl.raw;
    const cleaned = cleanText(raw);
    if (!cleaned) {
      continue;
    }

    try {
      const parsed = new URL(cleaned);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      continue;
    }
  }

  return "";
}

function extractCollectionAuthSchemes(
  auth: PostmanAuth | undefined
): { type: string; name: string; details: Record<string, string> }[] {
  if (!auth || typeof auth.type !== "string") {
    return [];
  }

  const rawDetails = auth[auth.type];
  const details: Record<string, string> = {};
  if (Array.isArray(rawDetails)) {
    for (const entry of rawDetails) {
      if (!isObject(entry)) {
        continue;
      }
      const key = cleanText(String(entry.key ?? ""));
      if (!key) {
        continue;
      }
      details[key] = cleanText(String(entry.value ?? ""));
    }
  }

  return [{ type: auth.type, name: auth.type, details }];
}

function toVariableMap(variables: PostmanVariable[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const variable of variables ?? []) {
    const key = cleanText(variable.key);
    if (!key) {
      continue;
    }
    map[key] = cleanText(String(variable.value ?? ""));
  }
  return map;
}

function getDescription(value: string | { content?: string } | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return cleanText(value) || undefined;
  }
  return cleanText(value.content) || undefined;
}

function getVersion(version: PostmanVersion | undefined): string | undefined {
  if (!version) {
    return undefined;
  }

  if (typeof version === "string") {
    return cleanText(version) || undefined;
  }

  const major = typeof version.major === "number" ? version.major : 0;
  const minor = typeof version.minor === "number" ? version.minor : 0;
  const patch = typeof version.patch === "number" ? version.patch : 0;
  return `${major}.${minor}.${patch}`;
}

function toAllowedMethod(method: string | undefined): ParsedEndpoint["method"] {
  const upper = cleanText(method).toUpperCase();
  if (ALLOWED_METHODS.has(upper)) {
    return upper as ParsedEndpoint["method"];
  }
  return "GET";
}

function getContentType(headers: ParsedHeader[]): string | undefined {
  const header = headers.find((h) => h.key.toLowerCase() === "content-type");
  return cleanText(header?.value) || undefined;
}

function resolveVariables(value: string, variables: Record<string, string>): string {
  return value.replace(/{{\s*([^{}\s]+)\s*}}/g, (_full, key: string) => {
    return variables[key] ?? `{{${key}}}`;
  });
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return `ep_${Math.abs(hash).toString(36)}`;
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

async function readFileOrThrow(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    throw new Error(`Could not read file: ${filePath}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
