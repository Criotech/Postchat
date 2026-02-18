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

const SUPPORTED_SCHEMA_MARKERS = ["v2.0", "v2.1"];

export function parseCollection(filePath: string): string {
  const content = readCollectionFile(filePath);
  const collection = parseCollectionJson(content);
  validateSchema(collection);

  const parsedRequests: ParsedRequest[] = [];
  for (const item of collection.item ?? []) {
    walkItems(item, parsedRequests);
  }

  if (parsedRequests.length === 0) {
    return "No requests found in this collection.";
  }

  return parsedRequests.map(formatRequestMarkdown).join("\n\n");
}

export async function pickCollectionFile(): Promise<string | undefined> {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: {
      "JSON Files": ["json"]
    },
    openLabel: "Select Postman Collection"
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
    if (error instanceof Error && error.message.includes("Unexpected token")) {
      throw new Error(`Malformed JSON in collection file: ${error.message}`);
    }
    if (error instanceof Error && error.message.includes("JSON")) {
      throw new Error(`Malformed JSON in collection file: ${error.message}`);
    }
    throw error;
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

function walkItems(item: PostmanItem, output: ParsedRequest[]): void {
  if (item.item && item.item.length > 0) {
    for (const nested of item.item) {
      walkItems(nested, output);
    }
  }

  if (!item.request) {
    return;
  }

  output.push({
    name: item.name?.trim() || "Unnamed Request",
    description: getDescription(item.request.description ?? item.description),
    method: (item.request.method || "GET").toUpperCase(),
    url: getRawUrl(item.request.url),
    headers: formatHeaders(item.request.header),
    body: formatBody(item.request.body)
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

function getRawUrl(url: string | { raw?: string } | undefined): string {
  if (!url) {
    return "Unknown";
  }

  if (typeof url === "string") {
    return escapeInlineCode(collapseWhitespace(url) || "Unknown");
  }

  return escapeInlineCode(collapseWhitespace(url.raw ?? "") || "Unknown");
}

function formatHeaders(
  headers: Array<{ key?: string; value?: string; disabled?: boolean }> | undefined
): string {
  const activeHeaders = (headers ?? []).filter((header) => !header.disabled && header.key);

  if (activeHeaders.length === 0) {
    return "None";
  }

  return activeHeaders
    .map((header) => `${header.key}: ${header.value ?? ""}`.trim())
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
    | undefined
): string {
  if (!body || !body.mode) {
    return "None";
  }

  if (body.mode === "raw") {
    const raw = collapseWhitespace(body.raw ?? "");
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
    `- **URL:** \`${request.url}\``,
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
