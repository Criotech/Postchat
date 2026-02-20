import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";

export type SpecType = "postman" | "openapi3" | "swagger2" | "unknown";

type OpenApiKind = "openapi3" | "swagger2";
type JsonObject = Record<string, unknown>;
type SecurityRequirement = {
  scheme: string;
  scopes: string[];
};
type ParameterDescriptor = {
  name: string;
  location: "path" | "query" | "header" | "body";
  type: string;
  required: boolean;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;
const RESPONSE_CODES = ["200", "201", "400", "401", "404"] as const;
const UNRECOGNIZED_SPEC_ERROR =
  "Unrecognized file format. Please select a Postman Collection or OpenAPI/Swagger specification.";
const INVALID_YAML_ERROR = "Invalid YAML — could not parse the spec file.";

export function detectSpecType(filePath: string): SpecType {
  const preview = readFirstLines(filePath, 50);
  if (!preview) {
    return "unknown";
  }

  if (/(?:^|\n)\s*["']?_postman_id["']?\s*:/i.test(preview)) {
    return "postman";
  }

  if (/(?:^|\n)\s*["']?openapi["']?\s*:\s*["']?3\./i.test(preview)) {
    return "openapi3";
  }

  if (/(?:^|\n)\s*["']?swagger["']?\s*:\s*["']?2\./i.test(preview)) {
    return "swagger2";
  }

  if (/(?:^|\n)\s*["']?item["']?\s*:\s*(?:\[|$)/i.test(preview)) {
    return "postman";
  }

  return "unknown";
}

export function parseOpenApi(filePath: string): string {
  const spec = parseSpecFile(filePath);
  const kind = detectKindFromDocument(spec);

  if (kind === "unknown") {
    throw new Error(UNRECOGNIZED_SPEC_ERROR);
  }

  return buildSpecMarkdown(spec, kind);
}

function parseSpecFile(filePath: string): JsonObject {
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read spec file: ${message}`);
  }

  const extension = path.extname(filePath).toLowerCase();
  let parsed: unknown;

  if (extension === ".yaml" || extension === ".yml") {
    try {
      parsed = yaml.load(content);
    } catch {
      throw new Error(INVALID_YAML_ERROR);
    }
  } else if (extension === ".json") {
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Malformed JSON in spec file: ${message}`);
    }
  } else {
    throw new Error(
      "Unsupported file extension. Please select a .json, .yaml, or .yml specification file."
    );
  }

  if (!isObject(parsed)) {
    throw new Error(UNRECOGNIZED_SPEC_ERROR);
  }

  return parsed;
}

function readFirstLines(filePath: string, maxLines: number): string {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.split(/\r?\n/).slice(0, maxLines).join("\n");
  } catch {
    return "";
  }
}

function detectKindFromDocument(doc: JsonObject): OpenApiKind | "unknown" {
  const openapi = asString(doc.openapi);
  if (openapi?.startsWith("3.")) {
    return "openapi3";
  }

  const swagger = asString(doc.swagger);
  if (swagger?.startsWith("2.")) {
    return "swagger2";
  }

  return "unknown";
}

function buildSpecMarkdown(spec: JsonObject, kind: OpenApiKind): string {
  const info = asObject(spec.info);
  const title = normalizeText(asString(info?.title) ?? "") || "Untitled API";
  const version = normalizeText(asString(info?.version) ?? "") || "unknown";
  const baseUrl = getBaseUrl(spec, kind);
  const securitySchemes = getSecuritySchemes(spec, kind);
  const securitySchemeLine =
    securitySchemes.length === 0 ? "None" : securitySchemes.map((entry) => `\`${entry}\``).join(", ");

  const metadataLines = [
    `## ${title} (v${version})`,
    `- **Spec:** ${kind === "openapi3" ? "OpenAPI 3.x" : "Swagger 2.x"}`,
    `- **Base URL:** \`${escapeInlineCode(baseUrl)}\``,
    `- **Security Schemes:** ${securitySchemeLine}`
  ];

  const endpoints = extractEndpoints(spec, kind, baseUrl);
  if (endpoints.length === 0) {
    metadataLines.push("- **Endpoints:** None");
    return metadataLines.join("\n");
  }

  return `${metadataLines.join("\n")}\n\n${endpoints.join("\n\n")}`;
}

function extractEndpoints(spec: JsonObject, kind: OpenApiKind, baseUrl: string): string[] {
  const paths = asObject(spec.paths);
  if (!paths) {
    return [];
  }

  const schemeMap = getSecuritySchemeMap(spec, kind);
  const endpointBlocks: string[] = [];

  for (const [rawPath, pathValue] of Object.entries(paths)) {
    const pathItem = resolveObject(spec, pathValue);
    if (!pathItem) {
      continue;
    }

    const pathParameters = extractParameters(spec, pathItem.parameters, kind);

    for (const method of HTTP_METHODS) {
      const operation = resolveObject(spec, pathItem[method]);
      if (!operation) {
        continue;
      }

      const operationParameters = extractParameters(spec, operation.parameters, kind);
      const parameters = mergeParameters(pathParameters, operationParameters);
      const parameterLine = formatParameters(parameters);
      const requestBodySchema = getRequestBodySchema(
        spec,
        kind,
        pathItem.parameters,
        operation.parameters,
        operation.requestBody
      );
      const responseLine = getResponseSchemas(spec, kind, operation.responses);
      const security = extractSecurityRequirements(spec, operation);
      const securityLine = formatSecurityRequirements(security);
      const authHeaders = getAuthHeadersForSecurity(security, schemeMap);
      const headers = formatHeaders(parameters, authHeaders);
      const summary = normalizeText(asString(operation.summary) ?? "");
      const operationId = normalizeText(asString(operation.operationId) ?? "");
      const name = summary || operationId || rawPath;
      const description = getDescription(operation);
      const url = buildEndpointUrl(baseUrl, rawPath);

      endpointBlocks.push(
        [
          `### [${method.toUpperCase()}] ${name}`,
          `- **URL:** \`${escapeInlineCode(url)}\``,
          `- **Description:** ${description}`,
          `- **Headers:** ${headers}`,
          "- **Body:** None",
          `- **Parameters:** ${parameterLine}`,
          `- **Request Body Schema:** ${requestBodySchema}`,
          `- **Responses:** ${responseLine}`,
          `- **Security:** ${securityLine}`
        ].join("\n")
      );
    }
  }

  return endpointBlocks;
}

function getDescription(operation: JsonObject): string {
  const summary = normalizeText(asString(operation.summary) ?? "");
  const description = normalizeText(asString(operation.description) ?? "");

  if (summary && description && summary !== description) {
    return `${summary} - ${description}`;
  }

  return summary || description || "None";
}

function extractParameters(
  spec: JsonObject,
  rawParameters: unknown,
  kind: OpenApiKind
): ParameterDescriptor[] {
  if (!Array.isArray(rawParameters)) {
    return [];
  }

  const parameters: ParameterDescriptor[] = [];

  for (const rawParameter of rawParameters) {
    const parameter = resolveObject(spec, rawParameter);
    if (!parameter) {
      continue;
    }

    const location = asString(parameter.in);
    if (location !== "path" && location !== "query" && location !== "header" && location !== "body") {
      continue;
    }

    const name = normalizeText(asString(parameter.name) ?? "");
    if (!name) {
      continue;
    }

    const required = location === "path" ? true : Boolean(parameter.required);
    const type = getParameterType(spec, parameter, kind);
    parameters.push({ name, location, type, required });
  }

  return parameters;
}

function mergeParameters(
  baseParameters: ParameterDescriptor[],
  operationParameters: ParameterDescriptor[]
): ParameterDescriptor[] {
  const merged = new Map<string, ParameterDescriptor>();

  for (const parameter of baseParameters) {
    merged.set(`${parameter.location}:${parameter.name}`, parameter);
  }

  for (const parameter of operationParameters) {
    merged.set(`${parameter.location}:${parameter.name}`, parameter);
  }

  return Array.from(merged.values());
}

function formatParameters(parameters: ParameterDescriptor[]): string {
  const filtered = parameters.filter(
    (parameter) =>
      parameter.location === "path" ||
      parameter.location === "query" ||
      parameter.location === "header"
  );

  if (filtered.length === 0) {
    return "None";
  }

  return filtered
    .map(
      (parameter) =>
        `\`${parameter.location}.${escapeInlineCode(parameter.name)}\` (${parameter.type}, ${
          parameter.required ? "required" : "optional"
        })`
    )
    .join(", ");
}

function getRequestBodySchema(
  spec: JsonObject,
  kind: OpenApiKind,
  pathParameters: unknown,
  operationParameters: unknown,
  requestBody: unknown
): string {
  if (kind === "openapi3") {
    const body = resolveObject(spec, requestBody);
    const content = asObject(body?.content);

    if (!content || Object.keys(content).length === 0) {
      return "None";
    }

    const parts: string[] = [];
    for (const [mediaType, mediaTypeSchema] of Object.entries(content)) {
      const mediaObject = resolveObject(spec, mediaTypeSchema);
      const schemaText = summarizeSchema(spec, mediaObject?.schema);
      parts.push(`${mediaType}: ${schemaText}`);
    }

    return formatInlineList(parts);
  }

  const combined = [...toArray(pathParameters), ...toArray(operationParameters)];
  for (const rawParameter of combined) {
    const parameter = resolveObject(spec, rawParameter);
    if (!parameter || asString(parameter.in) !== "body") {
      continue;
    }
    return summarizeSchema(spec, parameter.schema);
  }

  return "None";
}

function getResponseSchemas(spec: JsonObject, kind: OpenApiKind, responses: unknown): string {
  const responseObject = asObject(responses);
  if (!responseObject) {
    return "None";
  }

  const lines: string[] = [];

  for (const statusCode of RESPONSE_CODES) {
    const response = resolveObject(spec, responseObject[statusCode]);
    if (!response) {
      continue;
    }

    const responseDescription = normalizeText(asString(response.description) ?? "");
    let schemaText = "None";

    if (kind === "openapi3") {
      const content = asObject(response.content);
      if (content && Object.keys(content).length > 0) {
        const contentSchemas: string[] = [];
        for (const [mediaType, mediaTypeObject] of Object.entries(content)) {
          const media = resolveObject(spec, mediaTypeObject);
          contentSchemas.push(`${mediaType}: ${summarizeSchema(spec, media?.schema)}`);
        }
        schemaText = formatInlineList(contentSchemas);
      }
    } else {
      schemaText = summarizeSchema(spec, response.schema);
    }

    const combined =
      schemaText !== "None" && responseDescription
        ? `${schemaText} - ${responseDescription}`
        : schemaText !== "None"
          ? schemaText
          : responseDescription || "None";

    lines.push(`${statusCode}: ${combined}`);
  }

  return lines.length === 0 ? "None" : formatInlineList(lines);
}

function getSecuritySchemes(spec: JsonObject, kind: OpenApiKind): string[] {
  const schemes = getSecuritySchemeMap(spec, kind);
  const entries: string[] = [];

  for (const [name, rawScheme] of Object.entries(schemes)) {
    const scheme = resolveObject(spec, rawScheme) ?? rawScheme;
    const type = normalizeText(asString(scheme.type) ?? "") || "unknown";

    if (type === "apiKey") {
      const inValue = normalizeText(asString(scheme.in) ?? "") || "unknown";
      const parameterName = normalizeText(asString(scheme.name) ?? "") || "unknown";
      entries.push(`${name}: apiKey (${inValue}: ${parameterName})`);
      continue;
    }

    if (type === "http") {
      const httpScheme = normalizeText(asString(scheme.scheme) ?? "") || "unknown";
      entries.push(`${name}: http ${httpScheme}`);
      continue;
    }

    if (type === "oauth2") {
      const flows = asObject(scheme.flows);
      const flowNames = flows ? Object.keys(flows).join(", ") : "implicit";
      entries.push(`${name}: oauth2 (${flowNames})`);
      continue;
    }

    if (type === "basic") {
      entries.push(`${name}: http basic`);
      continue;
    }

    entries.push(`${name}: ${type}`);
  }

  return entries;
}

function getSecuritySchemeMap(spec: JsonObject, kind: OpenApiKind): Record<string, JsonObject> {
  if (kind === "openapi3") {
    const components = asObject(spec.components);
    const schemes = asObject(components?.securitySchemes);
    return toObjectMap(schemes);
  }

  return toObjectMap(asObject(spec.securityDefinitions));
}

function extractSecurityRequirements(spec: JsonObject, operation: JsonObject): SecurityRequirement[] {
  const operationSecurity = operation.security;
  const operationParsed = parseSecurityRequirementArray(operationSecurity);

  if (Array.isArray(operationSecurity)) {
    // OpenAPI allows explicit empty array to mean "no auth for this operation".
    return operationParsed;
  }

  return parseSecurityRequirementArray(spec.security);
}

function parseSecurityRequirementArray(value: unknown): SecurityRequirement[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const requirements: SecurityRequirement[] = [];

  for (const rawRequirement of value) {
    const requirement = asObject(rawRequirement);
    if (!requirement) {
      continue;
    }

    for (const [schemeName, scopesValue] of Object.entries(requirement)) {
      const scopes = Array.isArray(scopesValue)
        ? scopesValue.map((scope) => normalizeText(String(scope))).filter(Boolean)
        : [];
      requirements.push({ scheme: schemeName, scopes });
    }
  }

  return requirements;
}

function formatSecurityRequirements(requirements: SecurityRequirement[]): string {
  if (requirements.length === 0) {
    return "None";
  }

  return formatInlineList(
    requirements.map((requirement) =>
      requirement.scopes.length > 0
        ? `${requirement.scheme} (${requirement.scopes.join(", ")})`
        : requirement.scheme
    )
  );
}

function getAuthHeadersForSecurity(
  requirements: SecurityRequirement[],
  schemeMap: Record<string, JsonObject>
): string[] {
  const headers = new Set<string>();

  for (const requirement of requirements) {
    const scheme = schemeMap[requirement.scheme];
    const schemeType = normalizeText(asString(scheme?.type) ?? "");

    if (schemeType === "apiKey") {
      const inValue = normalizeText(asString(scheme?.in) ?? "");
      const name = normalizeText(asString(scheme?.name) ?? "");
      if (inValue === "header" && name) {
        headers.add(`${name}: <api-key>`);
      }
      continue;
    }

    if (schemeType === "http") {
      const httpScheme = normalizeText(asString(scheme?.scheme) ?? "");
      if (httpScheme === "basic") {
        headers.add("Authorization: Basic <credentials>");
      } else {
        headers.add("Authorization: Bearer <token>");
      }
      continue;
    }

    if (schemeType === "basic") {
      headers.add("Authorization: Basic <credentials>");
      continue;
    }

    if (schemeType === "oauth2") {
      headers.add("Authorization: Bearer <token>");
    }
  }

  return Array.from(headers.values());
}

function formatHeaders(parameters: ParameterDescriptor[], authHeaders: string[]): string {
  const headerHints = new Set<string>();

  for (const parameter of parameters) {
    if (parameter.location !== "header") {
      continue;
    }

    const suffix = parameter.required ? "required" : "optional";
    headerHints.add(`${parameter.name}: <${parameter.type}> (${suffix})`);
  }

  for (const authHeader of authHeaders) {
    headerHints.add(authHeader);
  }

  if (headerHints.size === 0) {
    return "None";
  }

  return Array.from(headerHints.values())
    .map((header) => `\`${escapeInlineCode(header)}\``)
    .join(", ");
}

function getParameterType(spec: JsonObject, parameter: JsonObject, kind: OpenApiKind): string {
  if (kind === "swagger2") {
    const directType = normalizeText(asString(parameter.type) ?? "");
    if (directType) {
      return directType;
    }
  }

  return summarizeSchemaType(spec, parameter.schema) || "string";
}

function summarizeSchemaType(spec: JsonObject, schema: unknown): string {
  const schemaObject = resolveObject(spec, schema);
  if (!schemaObject) {
    return "";
  }

  const schemaRef = asString(schemaObject.$ref);
  if (schemaRef) {
    return shortRef(schemaRef);
  }

  const schemaType = normalizeText(asString(schemaObject.type) ?? "");
  if (schemaType === "array") {
    const itemType = summarizeSchemaType(spec, schemaObject.items);
    return itemType ? `array<${itemType}>` : "array";
  }

  if (schemaType === "object") {
    const properties = asObject(schemaObject.properties);
    if (!properties || Object.keys(properties).length === 0) {
      return "object";
    }

    const propertyNames = Object.keys(properties).slice(0, 4);
    const extra = Object.keys(properties).length > propertyNames.length ? ", ..." : "";
    return `object{${propertyNames.join(", ")}${extra}}`;
  }

  if (schemaType) {
    return schemaType;
  }

  if (Array.isArray(schemaObject.oneOf)) {
    return "oneOf";
  }

  if (Array.isArray(schemaObject.anyOf)) {
    return "anyOf";
  }

  if (Array.isArray(schemaObject.allOf)) {
    return "allOf";
  }

  return "schema";
}

function summarizeSchema(spec: JsonObject, schema: unknown): string {
  const schemaObject = resolveObject(spec, schema);
  if (!schemaObject) {
    return "None";
  }

  const ref = asString(schemaObject.$ref);
  if (ref) {
    return shortRef(ref);
  }

  const byType = summarizeSchemaType(spec, schemaObject);
  if (byType && byType !== "schema") {
    return byType;
  }

  const serialized = JSON.stringify(schemaObject);
  if (!serialized) {
    return "None";
  }

  return truncate(normalizeText(serialized), 220);
}

function shortRef(ref: string): string {
  const parts = ref.split("/");
  return parts[parts.length - 1] || ref;
}

function getBaseUrl(spec: JsonObject, kind: OpenApiKind): string {
  if (kind === "openapi3") {
    const servers = Array.isArray(spec.servers) ? spec.servers : [];
    const firstServer = resolveObject(spec, servers[0]);
    const url = normalizeText(asString(firstServer?.url) ?? "");
    return url || "Unknown";
  }

  const host = normalizeText(asString(spec.host) ?? "");
  const basePath = normalizeText(asString(spec.basePath) ?? "");
  const schemes = Array.isArray(spec.schemes)
    ? spec.schemes.map((entry) => normalizeText(String(entry))).filter(Boolean)
    : [];
  const scheme = schemes[0] || "https";

  if (host) {
    return `${scheme}://${host}${basePath || ""}`;
  }

  return basePath || "Unknown";
}

function buildEndpointUrl(baseUrl: string, rawPath: string): string {
  if (/^https?:\/\//i.test(rawPath)) {
    return rawPath;
  }

  if (baseUrl === "Unknown") {
    return rawPath;
  }

  const trimmedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${trimmedBase}${normalizedPath}`;
}

function resolveObject(root: JsonObject, value: unknown): JsonObject | undefined {
  const objectValue = asObject(value);
  if (!objectValue) {
    return undefined;
  }

  const ref = asString(objectValue.$ref);
  if (!ref || !ref.startsWith("#/")) {
    return objectValue;
  }

  const tokens = ref
    .slice(2)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));

  let cursor: unknown = root;
  for (const token of tokens) {
    if (!isObject(cursor) || !(token in cursor)) {
      return objectValue;
    }
    cursor = cursor[token];
  }

  return asObject(cursor) ?? objectValue;
}

function asObject(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}

function toObjectMap(value: JsonObject | undefined): Record<string, JsonObject> {
  if (!value) {
    return {};
  }

  const map: Record<string, JsonObject> = {};
  for (const [key, entry] of Object.entries(value)) {
    const objectEntry = asObject(entry);
    if (objectEntry) {
      map[key] = objectEntry;
    }
  }
  return map;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, "\\`");
}

function formatInlineList(values: string[]): string {
  const filtered = values.map((value) => normalizeText(value)).filter(Boolean);
  if (filtered.length === 0) {
    return "None";
  }
  return filtered.join("; ");
}
