export type SnippetFormat = "curl" | "fetch" | "axios" | "python" | "httpie";

export type ParsedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export function convertSnippet(
  params: { method: string; url: string; headers: Record<string, string>; body?: string },
  format: SnippetFormat
): string {
  const method = (params.method || "GET").toUpperCase();
  const url = params.url;
  const headers = params.headers ?? {};
  const body = params.body;

  if (format === "curl") {
    const headerFlags = Object.entries(headers)
      .map(([key, value]) => `-H "${key}: ${escapeDoubleQuotes(value)}"`)
      .join(" ");
    const dataFlag = body ? ` -d '${escapeSingleQuotes(body)}'` : "";
    return [`curl -X ${method} "${url}"`, headerFlags].filter(Boolean).join(" ") + dataFlag;
  }

  if (format === "fetch") {
    const lines = [
      `const response = await fetch("${url}", {`,
      `  method: "${method}",`,
      `  headers: ${toObjectLiteral(headers)},`
    ];
    if (body) {
      lines.push(`  body: ${toBodyLiteral(body)},`);
    }
    lines.push("});");
    return lines.join("\n");
  }

  if (format === "axios") {
    const methodName = method.toLowerCase();
    const dataValue = body ? toBodyLiteral(body) : "undefined";
    return [
      `const response = await axios.${methodName}(`,
      `  "${url}",`,
      `  ${dataValue},`,
      `  { headers: ${toObjectLiteral(headers)} }`,
      ");"
    ].join("\n");
  }

  if (format === "python") {
    const methodName = method.toLowerCase();
    const headerValue = toPythonDict(headers);
    const jsonBody = body ? tryParseJson(body) : null;
    if (jsonBody) {
      return [
        "import requests",
        "",
        `response = requests.${methodName}(`,
        `    "${url}",`,
        `    headers=${headerValue},`,
        `    json=${jsonBody}`,
        ")",
        "print(response.status_code)",
        "print(response.text)"
      ].join("\n");
    }

    return [
      "import requests",
      "",
      `response = requests.${methodName}(`,
      `    "${url}",`,
      `    headers=${headerValue},`,
      `    data=${toPythonString(body ?? "")}`,
      ")",
      "print(response.status_code)",
      "print(response.text)"
    ].join("\n");
  }

  const headerPairs = Object.entries(headers).map(
    ([key, value]) => `${key}:${escapeHttpieToken(value)}`
  );
  const bodyPairs = body ? toHttpieBodyTokens(body) : [];
  return ["http", method, url, ...headerPairs, ...bodyPairs].join(" ");
}

export function extractRequestFromCodeBlock(code: string): Partial<ParsedRequest> | null {
  const curlParsed = parseCurlSnippet(code);
  if (curlParsed) {
    return curlParsed;
  }

  const fetchParsed = parseFetchSnippet(code);
  if (fetchParsed) {
    return fetchParsed;
  }

  return null;
}

function parseCurlSnippet(code: string): Partial<ParsedRequest> | null {
  if (!/\bcurl\b/i.test(code)) {
    return null;
  }

  const methodMatch = code.match(/-X\s+([A-Za-z]+)/i);
  const method = methodMatch?.[1]?.toUpperCase() ?? "GET";

  const urlMatch =
    code.match(/curl(?:\s+-[^\n"']+\s+[^\n"']+)*\s+["']([^"']+)["']/i) ??
    code.match(/curl\s+(https?:\/\/[^\s"'`]+)/i);
  const url = urlMatch?.[1];

  const headers: Record<string, string> = {};
  const headerRegex = /-H\s+["']([^:"']+)\s*:\s*([^"']+)["']/gi;
  let headerMatch: RegExpExecArray | null;
  while ((headerMatch = headerRegex.exec(code)) !== null) {
    headers[headerMatch[1].trim()] = headerMatch[2].trim();
  }

  const bodyMatch =
    code.match(/-d\s+'([^']+)'/i) ??
    code.match(/-d\s+"([^"]+)"/i) ??
    code.match(/--data(?:-raw)?\s+'([^']+)'/i) ??
    code.match(/--data(?:-raw)?\s+"([^"]+)"/i);
  const body = bodyMatch?.[1];

  if (!url) {
    return null;
  }

  return { method, url, headers, body };
}

function parseFetchSnippet(code: string): Partial<ParsedRequest> | null {
  if (!/\bfetch\s*\(/i.test(code)) {
    return null;
  }

  const urlMatch = code.match(/fetch\(\s*["'`]([^"'`]+)["'`]/i);
  if (!urlMatch) {
    return null;
  }

  const url = urlMatch[1];
  const methodMatch = code.match(/method\s*:\s*["'`]([A-Za-z]+)["'`]/i);
  const method = methodMatch?.[1]?.toUpperCase() ?? "GET";

  const headers: Record<string, string> = {};
  const headersBlockMatch = code.match(/headers\s*:\s*\{([\s\S]*?)\}/i);
  if (headersBlockMatch) {
    const headerPairRegex = /["'`]([^"'`]+)["'`]\s*:\s*["'`]([^"'`]+)["'`]/g;
    let pair: RegExpExecArray | null;
    while ((pair = headerPairRegex.exec(headersBlockMatch[1])) !== null) {
      headers[pair[1]] = pair[2];
    }
  }

  const bodyMatch =
    code.match(/body\s*:\s*["'`]([\s\S]*?)["'`]\s*[,}]/i) ??
    code.match(/body\s*:\s*JSON\.stringify\(([\s\S]*?)\)\s*[,}]/i);
  const body = bodyMatch?.[1]?.trim();

  return { method, url, headers, body };
}

function toObjectLiteral(headers: Record<string, string>): string {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return "{}";
  }

  const body = entries
    .map(([key, value]) => `"${escapeDoubleQuotes(key)}": "${escapeDoubleQuotes(value)}"`)
    .join(", ");
  return `{ ${body} }`;
}

function toBodyLiteral(body: string): string {
  const json = tryParseJson(body);
  if (json) {
    return `JSON.stringify(${json})`;
  }
  return `"${escapeDoubleQuotes(body)}"`;
}

function toPythonDict(headers: Record<string, string>): string {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return "{}";
  }

  return `{${entries
    .map(([key, value]) => `${toPythonString(key)}: ${toPythonString(value)}`)
    .join(", ")}}`;
}

function toPythonString(value: string): string {
  return `'${escapeSingleQuotes(value)}'`;
}

function tryParseJson(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

function toHttpieBodyTokens(body: string): string[] {
  const json = tryParseJson(body);
  if (!json) {
    return [`body:=${JSON.stringify(body)}`];
  }

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return [`body:='${escapeSingleQuotes(body)}'`];
    }
    return Object.entries(parsed).map(([key, value]) => `${key}:=${JSON.stringify(value)}`);
  } catch {
    return [`body:='${escapeSingleQuotes(body)}'`];
  }
}

function escapeDoubleQuotes(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function escapeHttpieToken(value: string): string {
  return value.replace(/\s+/g, "\\ ");
}
