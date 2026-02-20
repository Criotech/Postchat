import * as fs from "node:fs";
import * as vscode from "vscode";

type PostmanCollection = {
  info?: {
    schema?: string;
  };
  item?: PostmanItem[];
};

type PostmanItem = {
  name?: string;
  description?: string | { content?: string };
  item?: PostmanItem[];
  request?: PostmanRequest;
};

type PostmanRequest = {
  method?: string;
  description?: string | { content?: string };
  url?: string | { raw?: string };
  header?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  body?: {
    mode?: string;
    raw?: string;
    urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  };
};

type ParsedRequest = {
  name: string;
  description: string;
  method: string;
  url: string;
  headers: string;
  body: string;
};

export type ParsedCollection = {
  markdown: string;
  requestCount: number;
};

const SUPPORTED_SCHEMA_MARKERS = ["v2.0", "v2.1"];

export function parseCollection(
  filePath: string,
  environment?: Record<string, string>
): string {
  return parseCollectionWithStats(filePath, environment).markdown;
}

export function parseCollectionWithStats(
  filePath: string,
  environment?: Record<string, string>
): ParsedCollection {
  const content = readCollectionFile(filePath);
  const collection = parseCollectionJson(content);
  validateSchema(collection);

  const parsedRequests: ParsedRequest[] = [];
  for (const item of collection.item ?? []) {
    walkItems(item, parsedRequests, environment);
  }

  return {
    markdown:
      parsedRequests.length === 0
        ? "No requests found in this collection."
        : parsedRequests.map(formatRequestMarkdown).join("\n\n"),
    requestCount: parsedRequests.length
  };
}

export async function pickCollectionFile(): Promise<string | undefined> {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: {
      "API Specification Files": ["json", "yaml", "yml"]
    },
    openLabel: "Select API Specification"
  });

  if (!files || files.length === 0) {
    return undefined;
  }

  return files[0].fsPath;
}

function readCollectionFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read collection file: ${message}`);
  }
}

function parseCollectionJson(content: string): PostmanCollection {
  try {
    const parsed = JSON.parse(content) as PostmanCollection;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Collection content must be a JSON object.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Malformed JSON in collection file: ${error.message}`);
    }

    throw new Error("Malformed JSON in collection file.");
  }
}

function validateSchema(collection: PostmanCollection): void {
  const schema = collection.info?.schema;

  if (!schema) {
    throw new Error(
      "Unsupported schema version: missing collection.info.schema (expected Postman Collection v2.0 or v2.1)."
    );
  }

  const isSupported = SUPPORTED_SCHEMA_MARKERS.some((marker) => schema.includes(marker));
  if (!isSupported) {
    throw new Error(
      `Unsupported schema version: ${schema}. Only Postman Collection v2.0 and v2.1 are supported.`
    );
  }
}

function walkItems(
  item: PostmanItem,
  output: ParsedRequest[],
  environment?: Record<string, string>
): void {
  if (item.item && item.item.length > 0) {
    for (const nested of item.item) {
      walkItems(nested, output, environment);
    }
  }

  if (!item.request) {
    return;
  }

  output.push({
    name: item.name?.trim() || "Unnamed Request",
    description: getDescription(item.request.description ?? item.description),
    method: (item.request.method || "GET").toUpperCase(),
    url: getRawUrl(item.request.url, environment),
    headers: formatHeaders(item.request.header, environment),
    body: formatBody(item.request.body, environment)
  });
}

function getDescription(value: string | { content?: string } | undefined): string {
  if (!value) {
    return "None";
  }

  if (typeof value === "string") {
    return collapseWhitespace(value) || "None";
  }

  return collapseWhitespace(value.content ?? "") || "None";
}

function getRawUrl(
  url: string | { raw?: string } | undefined,
  environment?: Record<string, string>
): string {
  if (!url) {
    return "Unknown";
  }

  if (typeof url === "string") {
    return resolveEnvironmentVariables(collapseWhitespace(url), environment) || "Unknown";
  }

  return resolveEnvironmentVariables(collapseWhitespace(url.raw ?? ""), environment) || "Unknown";
}

function formatHeaders(
  headers: Array<{ key?: string; value?: string; disabled?: boolean }> | undefined,
  environment?: Record<string, string>
): string {
  const activeHeaders = (headers ?? []).filter((header) => !header.disabled && header.key);

  if (activeHeaders.length === 0) {
    return "None";
  }

  return activeHeaders
    .map((header) =>
      resolveEnvironmentVariables(`${header.key}: ${header.value ?? ""}`.trim(), environment)
    )
    .map((header) => `\`${escapeInlineCode(collapseWhitespace(header))}\``)
    .join(", ");
}

function formatBody(
  body:
    | {
        mode?: string;
        raw?: string;
        urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
      }
    | undefined,
  environment?: Record<string, string>
): string {
  if (!body || !body.mode) {
    return "None";
  }

  if (body.mode === "raw") {
    const raw = resolveEnvironmentVariables(collapseWhitespace(body.raw ?? ""), environment);
    return raw ? `\`${escapeInlineCode(raw)}\`` : "None";
  }

  if (body.mode === "urlencoded") {
    const keys = (body.urlencoded ?? [])
      .filter((entry) => !entry.disabled && entry.key)
      .map((entry) => entry.key as string);

    if (keys.length === 0) {
      return "None";
    }

    return `Keys: ${keys.map((key) => `\`${escapeInlineCode(key)}\``).join(", ")}`;
  }

  return `Unsupported body mode: ${body.mode}`;
}

function formatRequestMarkdown(request: ParsedRequest): string {
  return [
    `### [${request.method}] ${request.name}`,
    `- **URL:** \`${escapeInlineCode(request.url)}\``,
    `- **Description:** ${request.description}`,
    `- **Headers:** ${request.headers}`,
    `- **Body:** ${request.body}`
  ].join("\n");
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, "\\`");
}

function resolveEnvironmentVariables(
  value: string,
  environment?: Record<string, string>
): string {
  if (!value) {
    return value;
  }

  return value.replace(/{{\s*([^{}]+?)\s*}}/g, (match, variableName: string) => {
    const resolved = environment?.[variableName];
    return resolved !== undefined ? resolved : `${match} (unresolved)`;
  });
}
