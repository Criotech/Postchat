import type { ExecutableRequest } from "./requestExecutor";

/**
 * Parse a single request block from the collection markdown.
 *
 * Expected format (produced by collectionParser.ts):
 *   ### [METHOD] Request Name
 *   - **URL:** `https://example.com/api`
 *   - **Description:** Some description
 *   - **Headers:** `Content-Type: application/json`, `Authorization: Bearer token`
 *   - **Body:** `{"key":"value"}`
 */
function parseRequestBlock(block: string): ExecutableRequest | null {
  const titleMatch = block.match(/^###\s+(?:\[(\w+)]|(\w+))\s+(.+)/m);
  if (!titleMatch) {
    return null;
  }

  const method = (titleMatch[1] || titleMatch[2] || "").trim();
  const name = (titleMatch[3] || "").trim();

  const urlMatch = block.match(/\*\*URL:\*\*\s*`([^`]+)`/);
  const url = urlMatch?.[1] ?? "";
  if (!url || url === "Unknown") {
    return null;
  }

  const headers: Record<string, string> = {};
  const headersMatch = block.match(/\*\*Headers:\*\*\s*(.+)/);
  if (headersMatch && headersMatch[1].trim() !== "None") {
    const headerParts = headersMatch[1].match(/`([^`]+)`/g);
    if (headerParts) {
      for (const part of headerParts) {
        const cleaned = part.replace(/^`|`$/g, "").replace(/\\`/g, "`");
        const colonIndex = cleaned.indexOf(":");
        if (colonIndex > 0) {
          const key = cleaned.slice(0, colonIndex).trim();
          const value = cleaned.slice(colonIndex + 1).trim();
          headers[key] = value;
        }
      }
    }
  }

  let body: string | undefined;
  const bodyMatch =
    block.match(/\*\*Request Body:\*\*\s*(.+)/) ?? block.match(/\*\*Body:\*\*\s*(.+)/);
  if (bodyMatch && bodyMatch[1].trim() !== "None") {
    const bodyCodeMatch = bodyMatch[1].match(/`([^`]+)`/);
    if (bodyCodeMatch) {
      body = bodyCodeMatch[1].replace(/\\`/g, "`");
    }
  }

  return { name, method, url, headers, body };
}

function splitIntoBlocks(collectionMarkdown: string): string[] {
  return collectionMarkdown.split(/(?=^### (?:\[)?[A-Z]+\]? )/m).filter((b) => b.trim());
}

export function findRequestByName(
  collectionMarkdown: string,
  name: string
): ExecutableRequest | null {
  const lowerName = name.toLowerCase();
  for (const block of splitIntoBlocks(collectionMarkdown)) {
    const req = parseRequestBlock(block);
    if (req && req.name.toLowerCase() === lowerName) {
      return req;
    }
  }
  return null;
}

export function findRequestByKeyword(
  collectionMarkdown: string,
  keyword: string
): ExecutableRequest[] {
  const lowerKeyword = keyword.toLowerCase();
  const results: ExecutableRequest[] = [];

  for (const block of splitIntoBlocks(collectionMarkdown)) {
    const req = parseRequestBlock(block);
    if (!req) {
      continue;
    }

    if (
      req.name.toLowerCase().includes(lowerKeyword) ||
      req.url.toLowerCase().includes(lowerKeyword) ||
      req.method.toLowerCase() === lowerKeyword
    ) {
      results.push(req);
    }
  }

  return results;
}
