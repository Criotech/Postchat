import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExecutionResult } from "../RequestResult";
import { useBridge } from "../../lib/explorerBridge";
import type { ParsedEndpoint } from "../../types/spec";
import { ResponseViewer } from "./ResponseViewer";

type EndpointDetailProps = {
  endpoint: ParsedEndpoint | null;
  liveResult?: ExecutionResult | null;
  liveError?: string | null;
  onSendToAI?: (prompt: string) => void;
};

type EditableHeader = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

type QueryParamRow = {
  id: string;
  name: string;
  required: boolean;
  type: string;
  description?: string;
  included: boolean;
  value: string;
};

type JsonValidationState =
  | { status: "idle" }
  | { status: "valid" }
  | { status: "invalid"; message: string };

type DetailSection = "params" | "pathParams" | "queryParams" | "headers" | "body" | "responses";

const COMMON_HEADER_NAMES = [
  "Content-Type",
  "Accept",
  "Authorization",
  "X-API-Key",
  "User-Agent",
  "If-None-Match",
  "Cache-Control",
  "X-Request-Id"
];

const METHOD_BADGE_STYLES: Record<ParsedEndpoint["method"], string> = {
  GET: "bg-blue-600/20 text-blue-400 border border-blue-600/30",
  POST: "bg-green-600/20 text-green-400 border border-green-600/30",
  PUT: "bg-orange-600/20 text-orange-400 border border-orange-600/30",
  PATCH: "bg-yellow-600/20 text-yellow-400 border border-yellow-600/30",
  DELETE: "bg-red-600/20 text-red-400 border border-red-600/30",
  HEAD: "bg-gray-600/20 text-gray-400 border border-gray-600/30",
  OPTIONS: "bg-gray-600/20 text-gray-400 border border-gray-600/30"
};

function createRowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractPathParamNames(urlTemplate: string): string[] {
  const params = new Set<string>();
  const matcher = /\{([^{}]+)\}/g;
  let match = matcher.exec(urlTemplate);

  while (match) {
    const index = match.index;
    const fullMatch = match[0] ?? "";
    const previousChar = index > 0 ? urlTemplate[index - 1] : "";
    const nextChar = urlTemplate[index + fullMatch.length] ?? "";
    if (previousChar === "{" || nextChar === "}") {
      match = matcher.exec(urlTemplate);
      continue;
    }

    const name = match[1]?.trim();
    if (name) {
      params.add(name);
    }
    match = matcher.exec(urlTemplate);
  }

  return Array.from(params);
}

function applyPathParamValues(urlTemplate: string, values: Record<string, string>): string {
  return urlTemplate.replace(/\{([^{}]+)\}/g, (match, rawParam: string, offset: number, whole: string) => {
    const previousChar = offset > 0 ? whole[offset - 1] : "";
    const nextChar = whole[offset + match.length] ?? "";
    if (previousChar === "{" || nextChar === "}") {
      return match;
    }

    const key = String(rawParam).trim();
    const replacement = values[key];
    if (replacement === undefined || replacement.trim() === "") {
      return `{${key}}`;
    }
    return replacement.trim();
  });
}

function splitUrlParts(rawUrl: string): { template: string; query: string; hash: string } {
  const hashIndex = rawUrl.indexOf("#");
  const hash = hashIndex >= 0 ? rawUrl.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl;
  const queryIndex = withoutHash.indexOf("?");

  if (queryIndex === -1) {
    return {
      template: withoutHash,
      query: "",
      hash
    };
  }

  return {
    template: withoutHash.slice(0, queryIndex),
    query: withoutHash.slice(queryIndex + 1),
    hash
  };
}

function parseQueryEntries(query: string): Array<[string, string]> {
  const params = new URLSearchParams(query);
  const entries: Array<[string, string]> = [];
  params.forEach((value, key) => {
    entries.push([key, value]);
  });
  return entries;
}

function buildResolvedUrl(
  template: string,
  hash: string,
  pathParamValues: Record<string, string>,
  queryParams: QueryParamRow[],
  extraQueryParams: Array<[string, string]>
): string {
  const baseUrl = applyPathParamValues(template, pathParamValues);
  const searchParams = new URLSearchParams();

  for (const [key, value] of extraQueryParams) {
    if (key.trim()) {
      searchParams.append(key, value);
    }
  }

  for (const queryParam of queryParams) {
    if (queryParam.included && queryParam.name.trim()) {
      searchParams.append(queryParam.name, queryParam.value);
    }
  }

  const query = searchParams.toString();
  return `${baseUrl}${query ? `?${query}` : ""}${hash}`;
}

function normalizeEditableHeaders(headers: EditableHeader[]): Array<{ key: string; value: string; enabled: boolean }> {
  return headers
    .filter((header) => header.key.trim().length > 0 || header.value.trim().length > 0)
    .map((header) => ({
      key: header.key,
      value: header.value,
      enabled: header.enabled
    }));
}

function getResponseBadge(statusCode: string): string {
  const numeric = Number(statusCode);
  if (Number.isNaN(numeric)) {
    return "bg-gray-600/20 text-gray-400 border border-gray-600/30";
  }

  if (numeric >= 200 && numeric < 300) {
    return "bg-green-600/20 text-green-400 border border-green-600/30";
  }
  if (numeric >= 300 && numeric < 400) {
    return "bg-blue-600/20 text-blue-400 border border-blue-600/30";
  }
  if (numeric >= 400 && numeric < 500) {
    return "bg-orange-600/20 text-orange-400 border border-orange-600/30";
  }
  return "bg-red-600/20 text-red-400 border border-red-600/30";
}

function getEnabledHeaderValue(
  headers: Array<{ key: string; value: string; enabled: boolean }>,
  name: string
): string {
  const match = headers.find(
    (header) => header.enabled && header.key.trim().toLowerCase() === name.toLowerCase()
  );
  return match?.value ?? "";
}

function getBodyHint(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("application/json")) {
    return "Enter a JSON payload";
  }
  if (normalized.includes("application/x-www-form-urlencoded")) {
    return "Enter URL-encoded key=value pairs";
  }
  if (normalized.includes("multipart/form-data")) {
    return "Enter multipart/form-data values";
  }
  if (normalized.includes("xml")) {
    return "Enter an XML payload";
  }
  return "Enter request body";
}

function isJsonSchemaCandidate(value: unknown): value is Record<string, unknown> {
  return isObject(value) && ("$schema" in value || "properties" in value);
}

function generateExampleFromSchema(schema: unknown): unknown {
  if (!isObject(schema)) {
    return schema ?? "";
  }

  if (schema.example !== undefined) {
    return schema.example;
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return generateExampleFromSchema(schema.oneOf[0]);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return generateExampleFromSchema(schema.anyOf[0]);
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return generateExampleFromSchema(schema.allOf[0]);
  }

  const type = typeof schema.type === "string" ? schema.type : "";
  if (type === "object" || isObject(schema.properties)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const output: Record<string, unknown> = {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      output[key] = generateExampleFromSchema(propertySchema);
    }
    return output;
  }

  if (type === "array") {
    return [generateExampleFromSchema(schema.items)];
  }

  if (type === "integer" || type === "number") {
    return 0;
  }
  if (type === "boolean") {
    return false;
  }

  return "";
}

function parseJsonErrorLine(body: string, message: string): number | null {
  const positionMatch = message.match(/position\s+(\d+)/i);
  if (!positionMatch) {
    return null;
  }

  const position = Number(positionMatch[1]);
  if (Number.isNaN(position) || position < 0) {
    return null;
  }

  return body.slice(0, position).split(/\r?\n/).length;
}

function SectionHeader({
  title,
  isOpen,
  onToggle,
  trailing
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  trailing?: JSX.Element;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-vscode-panelBorder px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-sm font-semibold text-vscode-editorFg"
      >
        <span
          className={[
            "inline-block text-xs text-vscode-descriptionFg transition-transform duration-150",
            isOpen ? "rotate-90" : "rotate-0"
          ].join(" ")}
        >
          ▶
        </span>
        <span>{title}</span>
      </button>
      {trailing ? <div className="ml-auto">{trailing}</div> : null}
    </div>
  );
}

export function EndpointDetail({
  endpoint,
  liveResult,
  liveError,
  onSendToAI
}: EndpointDetailProps): JSX.Element {
  const { emit } = useBridge();

  const [urlTemplate, setUrlTemplate] = useState("");
  const [urlHashFragment, setUrlHashFragment] = useState("");
  const [pathParamValues, setPathParamValues] = useState<Record<string, string>>({});
  const [queryParams, setQueryParams] = useState<QueryParamRow[]>([]);
  const [extraQueryParams, setExtraQueryParams] = useState<Array<[string, string]>>([]);
  const [headers, setHeaders] = useState<EditableHeader[]>([]);
  const [bodyText, setBodyText] = useState("");
  const [initialBodyText, setInitialBodyText] = useState("");
  const [generatedFromSchema, setGeneratedFromSchema] = useState(false);
  const [jsonValidation, setJsonValidation] = useState<JsonValidationState>({ status: "idle" });
  const [sectionsOpen, setSectionsOpen] = useState<Record<DetailSection, boolean>>({
    params: true,
    pathParams: true,
    queryParams: true,
    headers: true,
    body: true,
    responses: true
  });
  const [expandedResponses, setExpandedResponses] = useState<Record<string, boolean>>({});

  const effectiveLiveResult = liveResult ?? null;

  useEffect(() => {
    if (!endpoint) {
      setUrlTemplate("");
      setUrlHashFragment("");
      setPathParamValues({});
      setQueryParams([]);
      setExtraQueryParams([]);
      setHeaders([]);
      setBodyText("");
      setInitialBodyText("");
      setGeneratedFromSchema(false);
      setJsonValidation({ status: "idle" });
      setExpandedResponses({});
      return;
    }

    const { template, query, hash } = splitUrlParts(endpoint.url);
    const templatePathParams = extractPathParamNames(template);
    const endpointPathParams = endpoint.parameters.filter((param) => param.location === "path");
    const queryEntries = parseQueryEntries(query);
    const queryMap = new Map(queryEntries);
    const knownQueryNames = new Set(
      endpoint.parameters
        .filter((param) => param.location === "query")
        .map((param) => param.name)
    );

    let nextBody = endpoint.requestBody ?? "";
    let generated = false;
    const isJsonRequest = endpoint.requestContentType?.toLowerCase().includes("application/json");
    if (isJsonRequest && nextBody.trim().length > 0) {
      try {
        const parsed = JSON.parse(nextBody);
        if (isJsonSchemaCandidate(parsed)) {
          const example = generateExampleFromSchema(parsed);
          nextBody = JSON.stringify(example, null, 2);
          generated = true;
        }
      } catch {
        // Keep existing request body if it is not valid JSON.
      }
    }

    setUrlTemplate(template);
    setUrlHashFragment(hash);
    setPathParamValues(
      templatePathParams.reduce<Record<string, string>>((acc, name) => {
        const parameterExample = endpointPathParams.find((param) => param.name === name)?.example?.trim();
        acc[name] = parameterExample || "";
        return acc;
      }, {})
    );
    setQueryParams(
      endpoint.parameters
        .filter((param) => param.location === "query")
        .map((param) => {
          const fromUrl = queryMap.get(param.name);
          return {
            id: createRowId(),
            name: param.name,
            required: param.required,
            type: param.type,
            description: param.description,
            included: param.required || fromUrl !== undefined,
            value: fromUrl ?? param.example ?? ""
          };
        })
    );
    setExtraQueryParams(queryEntries.filter(([name]) => !knownQueryNames.has(name)));
    setHeaders(
      endpoint.headers.map((header) => ({
        id: createRowId(),
        key: header.key,
        value: header.value,
        enabled: header.enabled
      }))
    );
    setBodyText(nextBody);
    setInitialBodyText(nextBody);
    setGeneratedFromSchema(generated);
    setJsonValidation({ status: "idle" });
    setExpandedResponses({});
  }, [endpoint]);

  const pathParams = useMemo(() => extractPathParamNames(urlTemplate), [urlTemplate]);

  const pathParamMeta = useMemo(() => {
    if (!endpoint) {
      return new Map<string, { required: boolean; description?: string; type: string }>();
    }

    const lookup = new Map<string, { required: boolean; description?: string; type: string }>();
    for (const param of endpoint.parameters) {
      if (param.location === "path") {
        lookup.set(param.name, {
          required: param.required,
          description: param.description,
          type: param.type
        });
      }
    }
    return lookup;
  }, [endpoint]);

  const requiredPathParams = useMemo(
    () =>
      pathParams.filter((name) => {
        const paramMeta = pathParamMeta.get(name);
        return paramMeta ? paramMeta.required : true;
      }),
    [pathParamMeta, pathParams]
  );

  const missingRequiredPathParams = useMemo(
    () => requiredPathParams.filter((name) => !pathParamValues[name]?.trim()),
    [pathParamValues, requiredPathParams]
  );

  const resolvedUrl = useMemo(
    () => buildResolvedUrl(urlTemplate, urlHashFragment, pathParamValues, queryParams, extraQueryParams),
    [extraQueryParams, pathParamValues, queryParams, urlHashFragment, urlTemplate]
  );

  const urlModified = endpoint ? resolvedUrl !== endpoint.url : false;

  const normalizedOriginalHeaders = useMemo(() => {
    if (!endpoint) {
      return [];
    }

    return endpoint.headers.map((header) => ({
      key: header.key,
      value: header.value,
      enabled: header.enabled
    }));
  }, [endpoint]);

  const normalizedEditedHeaders = useMemo(() => normalizeEditableHeaders(headers), [headers]);

  const headersModified = useMemo(() => {
    if (!endpoint) {
      return false;
    }

    return JSON.stringify(normalizedEditedHeaders) !== JSON.stringify(normalizedOriginalHeaders);
  }, [endpoint, normalizedEditedHeaders, normalizedOriginalHeaders]);

  const bodyModified = endpoint ? bodyText !== initialBodyText : false;
  const effectiveContentType =
    getEnabledHeaderValue(normalizedEditedHeaders, "Content-Type").trim() ||
    endpoint?.requestContentType ||
    "text/plain";
  const authHeaderValue = getEnabledHeaderValue(normalizedEditedHeaders, "Authorization");
  const showAuthWarning = Boolean(endpoint?.requiresAuth) && authHeaderValue.trim().length === 0;

  const editedEndpoint = useMemo<ParsedEndpoint | null>(() => {
    if (!endpoint) {
      return null;
    }

    return {
      ...endpoint,
      url: resolvedUrl,
      headers: normalizedEditedHeaders.map((header) => ({
        key: header.key,
        value: header.value,
        enabled: header.enabled
      })),
      requestBody: bodyText,
      requestContentType: effectiveContentType
    };
  }, [bodyText, effectiveContentType, endpoint, normalizedEditedHeaders, resolvedUrl]);

  const toggleSection = useCallback((section: DetailSection) => {
    setSectionsOpen((prev) => ({
      ...prev,
      [section]: !prev[section]
    }));
  }, []);

  const handleRun = useCallback(() => {
    if (!editedEndpoint || missingRequiredPathParams.length > 0) {
      return;
    }

    emit({ type: "runEndpoint", endpoint: editedEndpoint });
  }, [editedEndpoint, emit, missingRequiredPathParams.length]);

  const handleAskAI = useCallback(() => {
    if (!endpoint) {
      return;
    }

    emit({ type: "askAboutEndpoint", endpoint });
    emit({ type: "switchToChat" });
  }, [emit, endpoint]);

  const handleResetUrl = useCallback(() => {
    if (!endpoint) {
      return;
    }

    const { template, query, hash } = splitUrlParts(endpoint.url);
    const pathParamNames = extractPathParamNames(template);
    const queryEntries = parseQueryEntries(query);
    const queryMap = new Map(queryEntries);
    const knownQueryNames = new Set(
      endpoint.parameters
        .filter((param) => param.location === "query")
        .map((param) => param.name)
    );

    setUrlTemplate(template);
    setUrlHashFragment(hash);
    setPathParamValues(
      pathParamNames.reduce<Record<string, string>>((acc, name) => {
        acc[name] = "";
        return acc;
      }, {})
    );
    setQueryParams((prev) =>
      prev.map((row) => {
        const fromUrl = queryMap.get(row.name);
        return {
          ...row,
          included: row.required || fromUrl !== undefined,
          value: fromUrl ?? row.value
        };
      })
    );
    setExtraQueryParams(queryEntries.filter(([name]) => !knownQueryNames.has(name)));
  }, [endpoint]);

  const handleValidateJson = useCallback(() => {
    try {
      JSON.parse(bodyText);
      setJsonValidation({ status: "valid" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      const line = parseJsonErrorLine(bodyText, message);
      setJsonValidation({
        status: "invalid",
        message: line ? `Invalid JSON at line ${line}` : message
      });
    }
  }, [bodyText]);

  if (!endpoint) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-vscode-descriptionFg">
        Select an endpoint to view details
      </div>
    );
  }

  return (
    <div data-postchat-endpoint-detail="true" className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="border-b border-vscode-panelBorder px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={["rounded px-2 py-0.5 text-xs font-semibold", METHOD_BADGE_STYLES[endpoint.method]].join(" ")}>
            {endpoint.method}
          </span>
          <h2 className="min-w-0 flex-1 truncate text-base font-bold text-vscode-editorFg">{endpoint.name}</h2>
          {endpoint.requiresAuth ? (
            <span
              className="rounded border border-vscode-panelBorder bg-vscode-inputBg px-1.5 py-0.5 text-xs text-vscode-descriptionFg"
              title={endpoint.authType ? `Auth: ${endpoint.authType}` : "Auth required"}
            >
              🔑
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleRun}
            disabled={missingRequiredPathParams.length > 0}
            title={
              missingRequiredPathParams.length > 0
                ? "Fill in required parameters first"
                : "Run request"
            }
            className={[
              "rounded px-2.5 py-1 text-xs font-medium",
              missingRequiredPathParams.length > 0
                ? "cursor-not-allowed bg-vscode-buttonBg/60 text-vscode-buttonFg/70"
                : "bg-vscode-buttonBg text-vscode-buttonFg hover:bg-vscode-buttonHover"
            ].join(" ")}
          >
            ▶ Run Request
          </button>
          <button
            type="button"
            onClick={handleAskAI}
            className="rounded bg-vscode-buttonSecondaryBg px-2.5 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
          >
            💬 Ask AI
          </button>
        </div>

        <p className="mt-1 text-[10px] text-vscode-descriptionFg">R to run · A to ask AI</p>

        <div className="mt-3 rounded border border-vscode-panelBorder bg-vscode-inputBg px-2 py-2">
          <input
            value={resolvedUrl}
            onChange={(event) => {
              const { template, query, hash } = splitUrlParts(event.target.value);
              const nextPathParams = extractPathParamNames(template);
              const queryEntries = parseQueryEntries(query);
              const queryMap = new Map(queryEntries);
              const knownQueryParamNames = new Set(queryParams.map((param) => param.name));

              setUrlTemplate(template);
              setUrlHashFragment(hash);
              setPathParamValues((prev) => {
                const next: Record<string, string> = {};
                for (const paramName of nextPathParams) {
                  next[paramName] = prev[paramName] ?? "";
                }
                return next;
              });
              setQueryParams((prev) =>
                prev.map((row) => {
                  const fromUrl = queryMap.get(row.name);
                  return {
                    ...row,
                    included: row.required || fromUrl !== undefined,
                    value: fromUrl ?? row.value
                  };
                })
              );
              setExtraQueryParams(
                queryEntries.filter(([name]) => !knownQueryParamNames.has(name))
              );
            }}
            className="w-full border-none bg-transparent font-mono text-xs text-vscode-inputFg outline-none"
          />

          {urlModified ? (
            <button
              type="button"
              onClick={handleResetUrl}
              className="mt-2 text-xs text-vscode-linkFg underline"
            >
              Reset URL
            </button>
          ) : null}
        </div>
      </div>

      {endpoint.parameters.length > 0 ? (
        <section className="border-b border-vscode-panelBorder">
          <SectionHeader
            title="Parameters"
            isOpen={sectionsOpen.params}
            onToggle={() => toggleSection("params")}
          />
          {sectionsOpen.params ? (
            <div className="overflow-x-auto p-3">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-vscode-panelBorder text-vscode-descriptionFg">
                    <th className="px-2 py-1 font-medium">Name</th>
                    <th className="px-2 py-1 font-medium">In</th>
                    <th className="px-2 py-1 font-medium">Type</th>
                    <th className="px-2 py-1 font-medium">Required</th>
                    <th className="px-2 py-1 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoint.parameters.map((param) => (
                    <tr key={`${param.location}:${param.name}`} className="border-b border-vscode-panelBorder/40">
                      <td className="px-2 py-1 text-vscode-editorFg">
                        <span className={param.required ? "font-semibold" : ""}>{param.name}</span>
                        {param.required ? (
                          <span className="ml-1 rounded bg-orange-600/20 px-1 text-[10px] text-orange-300">*</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 text-vscode-descriptionFg">{param.location}</td>
                      <td className="px-2 py-1 text-vscode-descriptionFg">{param.type}</td>
                      <td className="px-2 py-1 text-vscode-descriptionFg">{param.required ? "Yes" : "No"}</td>
                      <td className="px-2 py-1 text-vscode-descriptionFg">{param.description || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {pathParams.length > 0 ? (
        <section className="border-b border-vscode-panelBorder">
          <SectionHeader
            title="Path Parameters"
            isOpen={sectionsOpen.pathParams}
            onToggle={() => toggleSection("pathParams")}
          />
          {sectionsOpen.pathParams ? (
            <div className="space-y-2 p-3">
              {pathParams.map((paramName) => {
                const required = requiredPathParams.includes(paramName);
                const missing = required && !pathParamValues[paramName]?.trim();
                const meta = pathParamMeta.get(paramName);
                return (
                  <div key={paramName} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                    <label className="text-xs font-medium text-vscode-editorFg">
                      {paramName}
                      {required ? <span className="ml-1 text-red-400">*</span> : null}
                    </label>
                    <input
                      value={pathParamValues[paramName] ?? ""}
                      onChange={(event) =>
                        setPathParamValues((prev) => ({
                          ...prev,
                          [paramName]: event.target.value
                        }))
                      }
                      placeholder={meta?.description || "Value"}
                      className={[
                        "rounded border bg-vscode-inputBg px-2 py-1 text-xs text-vscode-inputFg",
                        missing ? "border-red-500 outline-none ring-1 ring-red-500/50" : "border-vscode-inputBorder"
                      ].join(" ")}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {queryParams.length > 0 ? (
        <section className="border-b border-vscode-panelBorder">
          <SectionHeader
            title="Query Parameters"
            isOpen={sectionsOpen.queryParams}
            onToggle={() => toggleSection("queryParams")}
          />
          {sectionsOpen.queryParams ? (
            <div className="space-y-2 p-3">
              {queryParams.map((param) => (
                <div key={param.id} className="grid grid-cols-[auto_120px_minmax(0,1fr)] items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-vscode-editorFg">
                    <input
                      type="checkbox"
                      checked={param.included}
                      disabled={param.required}
                      onChange={(event) =>
                        setQueryParams((prev) =>
                          prev.map((row) =>
                            row.id === param.id ? { ...row, included: event.target.checked } : row
                          )
                        )
                      }
                    />
                    <span className={param.required ? "font-semibold" : ""}>
                      {param.name}
                      {param.required ? <span className="ml-1 text-orange-300">*</span> : null}
                    </span>
                  </label>
                  <span className="truncate text-[11px] text-vscode-descriptionFg">{param.type}</span>
                  <input
                    value={param.value}
                    onChange={(event) =>
                      setQueryParams((prev) =>
                        prev.map((row) =>
                          row.id === param.id ? { ...row, value: event.target.value } : row
                        )
                      )
                    }
                    placeholder={param.description || "Value"}
                    disabled={!param.included}
                    className={[
                      "rounded border px-2 py-1 text-xs",
                      param.included
                        ? "border-vscode-inputBorder bg-vscode-inputBg text-vscode-inputFg"
                        : "cursor-not-allowed border-vscode-inputBorder/40 bg-vscode-inputBg/40 text-vscode-descriptionFg"
                    ].join(" ")}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {endpoint.headers.length > 0 || endpoint.requiresAuth ? (
        <section className="border-b border-vscode-panelBorder">
          <SectionHeader
            title="Headers"
            isOpen={sectionsOpen.headers}
            onToggle={() => toggleSection("headers")}
            trailing={
              headersModified ? (
                <button
                  type="button"
                  onClick={() =>
                    setHeaders(
                      endpoint.headers.map((header) => ({
                        id: createRowId(),
                        key: header.key,
                        value: header.value,
                        enabled: header.enabled
                      }))
                    )
                  }
                  className="text-xs text-vscode-linkFg underline"
                >
                  Reset Headers
                </button>
              ) : undefined
            }
          />

          {sectionsOpen.headers ? (
            <div className="p-3">
              <datalist id="postchat-common-header-keys">
                {COMMON_HEADER_NAMES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>

              {showAuthWarning ? (
                <div
                  className="mb-2 rounded border border-yellow-600/40 bg-yellow-600/10 px-2 py-1 text-xs text-yellow-300"
                  title="This endpoint requires authentication"
                >
                  ⚠ This endpoint requires authentication
                </div>
              ) : null}

              <div className="space-y-2">
                {headers.map((header) => {
                  const isAuthorizationHeader = header.key.trim().toLowerCase() === "authorization";
                  const isBearer = header.value.startsWith("Bearer ");
                  const showRowAuthWarning =
                    endpoint.requiresAuth && isAuthorizationHeader && header.value.trim().length === 0;
                  return (
                    <div key={header.id} className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-center gap-2">
                      <input
                        value={header.key}
                        onChange={(event) =>
                          setHeaders((prev) =>
                            prev.map((row) =>
                              row.id === header.id ? { ...row, key: event.target.value } : row
                            )
                          )
                        }
                        list="postchat-common-header-keys"
                        placeholder="Header key"
                        className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs text-vscode-inputFg"
                      />
                      <input
                        value={header.value}
                        onChange={(event) =>
                          setHeaders((prev) =>
                            prev.map((row) =>
                              row.id === header.id ? { ...row, value: event.target.value } : row
                            )
                          )
                        }
                        placeholder="Header value"
                        className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs text-vscode-inputFg"
                      />
                      {isAuthorizationHeader ? (
                        <span
                          className="text-xs"
                          title={
                            isBearer
                              ? "Bearer token detected"
                              : showRowAuthWarning
                              ? "This endpoint requires authentication"
                              : "Authorization header"
                          }
                        >
                          {isBearer ? "🔑" : showRowAuthWarning ? "⚠️" : "•"}
                        </span>
                      ) : (
                        <span aria-hidden="true" />
                      )}
                      <label className="flex items-center gap-1 text-xs text-vscode-descriptionFg">
                        <input
                          type="checkbox"
                          checked={header.enabled}
                          onChange={(event) =>
                            setHeaders((prev) =>
                              prev.map((row) =>
                                row.id === header.id ? { ...row, enabled: event.target.checked } : row
                              )
                            )
                          }
                        />
                        enabled
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setHeaders((prev) => prev.filter((row) => row.id !== header.id))
                        }
                        className="rounded px-1 py-0.5 text-xs text-vscode-descriptionFg hover:bg-vscode-listHover"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() =>
                  setHeaders((prev) => [
                    ...prev,
                    {
                      id: createRowId(),
                      key: "",
                      value: "",
                      enabled: true
                    }
                  ])
                }
                className="mt-3 rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
              >
                Add Header
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {endpoint.requestBody !== undefined ? (
        <section className="border-b border-vscode-panelBorder">
          <SectionHeader
            title="Request Body"
            isOpen={sectionsOpen.body}
            onToggle={() => toggleSection("body")}
            trailing={
              bodyModified ? (
                <button
                  type="button"
                  onClick={() => {
                    setBodyText(initialBodyText);
                    setJsonValidation({ status: "idle" });
                  }}
                  className="text-xs text-vscode-linkFg underline"
                >
                  Reset Body
                </button>
              ) : undefined
            }
          />

          {sectionsOpen.body ? (
            <div className="p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-vscode-badgeBg px-1.5 py-0.5 text-[11px] text-vscode-badgeFg">
                  {effectiveContentType}
                </span>
                {generatedFromSchema ? (
                  <span className="rounded border border-vscode-panelBorder bg-vscode-inputBg px-1.5 py-0.5 text-[11px] text-vscode-descriptionFg">
                    Generated from schema
                  </span>
                ) : null}
                {effectiveContentType.toLowerCase().includes("application/json") ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(bodyText);
                          setBodyText(JSON.stringify(parsed, null, 2));
                          setJsonValidation({ status: "idle" });
                        } catch {
                          // Keep current body if invalid JSON.
                        }
                      }}
                      className="rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
                    >
                      Format JSON
                    </button>
                    <button
                      type="button"
                      onClick={handleValidateJson}
                      className="rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
                    >
                      Validate JSON
                    </button>
                  </>
                ) : null}
              </div>

              {jsonValidation.status === "valid" ? (
                <p className="mb-2 text-xs text-green-400">✓ Valid JSON</p>
              ) : null}
              {jsonValidation.status === "invalid" ? (
                <p className="mb-2 text-xs text-red-400">{jsonValidation.message}</p>
              ) : null}

              <textarea
                value={bodyText}
                onChange={(event) => {
                  setBodyText(event.target.value);
                  setJsonValidation({ status: "idle" });
                }}
                placeholder={getBodyHint(effectiveContentType)}
                className="h-44 w-full rounded border border-vscode-panelBorder bg-vscode-inputBg px-2 py-1 font-mono text-xs text-vscode-inputFg"
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="border-b border-vscode-panelBorder">
        <SectionHeader
          title="Responses"
          isOpen={sectionsOpen.responses}
          onToggle={() => toggleSection("responses")}
        />

        {sectionsOpen.responses ? (
          <div className="space-y-3 p-3">
            {effectiveLiveResult || liveError ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-vscode-descriptionFg">
                  Live Response
                </h3>
                <ResponseViewer
                  result={effectiveLiveResult}
                  error={liveError}
                  requestName={endpoint.name}
                  onSendToAI={onSendToAI}
                />
              </div>
            ) : null}

            {endpoint.responses.length === 0 ? (
              <p className="text-sm text-vscode-descriptionFg">No response examples provided.</p>
            ) : null}

            {endpoint.responses.map((response) => {
              const key = `${response.statusCode}-${response.description}`;
              const hasContent = Boolean(response.bodySchema || response.example);
              const isOpen = expandedResponses[key] ?? false;

              return (
                <article key={key} className="rounded border border-vscode-panelBorder bg-vscode-inputBg/30">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedResponses((prev) => ({
                        ...prev,
                        [key]: !isOpen
                      }))
                    }
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <span
                      className={[
                        "rounded px-1.5 py-0.5 text-[11px] font-semibold",
                        getResponseBadge(response.statusCode)
                      ].join(" ")}
                    >
                      {response.statusCode}
                    </span>
                    <span className="text-xs text-vscode-editorFg">{response.description || "Response"}</span>
                    <span className="ml-auto text-xs text-vscode-descriptionFg">
                      {hasContent ? (isOpen ? "Hide" : "Show") : "No body"}
                    </span>
                  </button>

                  {isOpen && hasContent ? (
                    <div className="space-y-2 border-t border-vscode-panelBorder px-3 py-2">
                      {response.bodySchema ? (
                        <div>
                          <p className="mb-1 text-[11px] uppercase tracking-wide text-vscode-descriptionFg">
                            Schema
                          </p>
                          <pre className="max-h-52 overflow-auto rounded bg-vscode-editorBg p-2 font-mono text-[11px] text-vscode-editorFg">
                            {response.bodySchema}
                          </pre>
                        </div>
                      ) : null}
                      {response.example ? (
                        <div>
                          <p className="mb-1 text-[11px] uppercase tracking-wide text-vscode-descriptionFg">
                            Example
                          </p>
                          <pre className="max-h-52 overflow-auto rounded bg-vscode-editorBg p-2 font-mono text-[11px] text-vscode-editorFg">
                            {response.example}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
