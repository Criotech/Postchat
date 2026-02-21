import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";
import type {
  ParsedCollection,
  ParsedEndpoint,
  ParsedHeader,
  ParsedParameter,
  ParsedResponse
} from "./types";

type UnknownRecord = Record<string, unknown>;
type OpenApiKind = "openapi3" | "swagger2";

const METHODS: Array<Lowercase<ParsedEndpoint["method"]>> = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options"
];

export async function parseOpenApi(filePath: string): Promise<ParsedCollection> {
  const rawSpec = await readFileOrThrow(filePath);
  const parsed = parseByExtensionOrContent(filePath, rawSpec);

  if (!isObject(parsed)) {
    throw new Error(
      "Unrecognized file format. Please select a Postman Collection (.json) or an OpenAPI/Swagger specification (.yaml, .yml, .json)."
    );
  }

  const kind = detectKind(parsed);
  if (!kind) {
    throw new Error(
      "Unrecognized file format. Please select a Postman Collection (.json) or an OpenAPI/Swagger specification (.yaml, .yml, .json)."
    );
  }

  const info = asObject(parsed.info);
  const title = text(info?.title) || "Untitled API";
  const version = text(info?.version) || undefined;
  const baseUrl = kind === "openapi3" ? getOpenApiBaseUrl(parsed) : getSwaggerBaseUrl(parsed);
  const securitySchemes = extractSecuritySchemes(parsed, kind);
  const topLevelSecurity = asArray(parsed.security);

  const endpoints = extractEndpoints(parsed, kind, baseUrl, securitySchemes, topLevelSecurity);

  return {
    specType: kind,
    title,
    version,
    baseUrl,
    description: text(info?.description) || undefined,
    endpoints,
    authSchemes: securitySchemes,
    rawSpec
  };
}

function extractEndpoints(
  root: UnknownRecord,
  kind: OpenApiKind,
  baseUrl: string,
  securitySchemes: { type: string; name: string; details: Record<string, string> }[],
  topLevelSecurity: unknown[]
): ParsedEndpoint[] {
  const paths = asObject(root.paths);
  if (!paths) {
    return [];
  }

  const endpoints: ParsedEndpoint[] = [];
  for (const [routePath, routeValue] of Object.entries(paths)) {
    const pathItem = resolveReference(root, routeValue);
    if (!pathItem) {
      continue;
    }

    const pathParams = normalizeParameters(root, asArray(pathItem.parameters));

    for (const method of METHODS) {
      const operationValue = pathItem[method];
      const operation = resolveReference(root, operationValue);
      if (!operation) {
        continue;
      }

      const operationParams = normalizeParameters(root, asArray(operation.parameters));
      const mergedParams = mergeParams(pathParams, operationParams);
      const headerParams = mergedParams.filter((param) => param.location === "header");
      const headers = headerParams.map((param) => ({
        key: param.name,
        value: param.example ?? `<${param.type}>`,
        enabled: true
      }));

      const contentType =
        kind === "openapi3"
          ? firstContentType(operation.requestBody, root)
          : firstArrayString(operation.consumes) || firstArrayString(root.consumes) || undefined;

      const requestBody =
        kind === "openapi3"
          ? extractOpenApiRequestBody(operation.requestBody, root)
          : extractSwaggerRequestBody(operation.parameters, root);

      const responseMap = asObject(operation.responses);
      const responses: ParsedResponse[] = [];
      for (const [statusCode, responseValue] of Object.entries(responseMap ?? {})) {
        const response = resolveReference(root, responseValue);
        if (!response) {
          continue;
        }

        const schema =
          kind === "openapi3"
            ? getOpenApiResponseSchema(response)
            : stringifyValue(resolveReference(root, response.schema) ?? response.schema);
        const example = kind === "openapi3" ? firstOpenApiResponseExample(response) : undefined;

        responses.push({
          statusCode,
          description: text(response.description) || "",
          bodySchema: schema || undefined,
          example: example || undefined
        });
      }

      const operationSecurity = asArray(operation.security);
      const hasExplicitSecurity = Array.isArray(operation.security);
      const effectiveSecurity = hasExplicitSecurity ? operationSecurity : topLevelSecurity;
      const requiresAuth = effectiveSecurity.length > 0;
      const authType = deriveAuthType(effectiveSecurity, securitySchemes);
      const fullUrl = `${baseUrl.replace(/\/$/, "")}${routePath}`;

      endpoints.push({
        id: slugify(`${method}:${routePath}`),
        name:
          text(operation.summary) ||
          text(operation.operationId) ||
          `${method.toUpperCase()} ${routePath}`,
        method: method.toUpperCase() as ParsedEndpoint["method"],
        url: fullUrl,
        path: routePath,
        folder: arrayText(operation.tags)?.[0] || "General",
        description: text(operation.description) || text(operation.summary) || undefined,
        headers,
        parameters: mergedParams,
        requestBody: requestBody || undefined,
        requestContentType: contentType,
        responses,
        requiresAuth,
        authType
      });
    }
  }

  return endpoints;
}

function extractSecuritySchemes(
  root: UnknownRecord,
  kind: OpenApiKind
): { type: string; name: string; details: Record<string, string> }[] {
  const rawSchemes =
    kind === "openapi3"
      ? asObject(asObject(root.components)?.securitySchemes)
      : asObject(root.securityDefinitions);

  const schemes: { type: string; name: string; details: Record<string, string> }[] = [];

  for (const [name, raw] of Object.entries(rawSchemes ?? {})) {
    const scheme = resolveReference(root, raw);
    if (!scheme) {
      continue;
    }

    const schemeType = text(scheme.type).toLowerCase();
    const details: Record<string, string> = {};
    let type = schemeType || "unknown";

    if (schemeType === "http") {
      const httpScheme = text(scheme.scheme).toLowerCase();
      if (httpScheme === "bearer") {
        type = "bearer";
      } else if (httpScheme === "basic") {
        type = "basic";
      }
    } else if (schemeType === "oauth2") {
      type = "oauth2";
      const flows = asObject(scheme.flows);
      if (flows) {
        for (const flow of Object.values(flows)) {
          const flowObj = asObject(flow);
          if (!flowObj) {
            continue;
          }
          const tokenUrl = text(flowObj.tokenUrl);
          const authorizationUrl = text(flowObj.authorizationUrl);
          if (tokenUrl) {
            details.tokenUrl = tokenUrl;
          }
          if (authorizationUrl) {
            details.authorizationUrl = authorizationUrl;
          }
          if (details.tokenUrl || details.authorizationUrl) {
            break;
          }
        }
      }
      const tokenUrl = text(scheme.tokenUrl);
      const authorizationUrl = text(scheme.authorizationUrl);
      if (tokenUrl && !details.tokenUrl) {
        details.tokenUrl = tokenUrl;
      }
      if (authorizationUrl && !details.authorizationUrl) {
        details.authorizationUrl = authorizationUrl;
      }
    } else if (schemeType === "apikey" || schemeType === "apiKey") {
      type = "apikey";
      const inValue = text(scheme.in);
      const keyName = text(scheme.name);
      if (inValue) {
        details.in = inValue;
      }
      if (keyName) {
        details.name = keyName;
      }
    }

    schemes.push({ type, name, details });
  }

  return schemes;
}

function normalizeParameters(root: UnknownRecord, rawParameters: unknown[]): ParsedParameter[] {
  const out: ParsedParameter[] = [];

  for (const rawParam of rawParameters) {
    const param = resolveReference(root, rawParam);
    if (!param) {
      continue;
    }

    const location = text(param.in) as ParsedParameter["location"];
    if (!["path", "query", "header", "cookie"].includes(location)) {
      continue;
    }

    const schema = resolveReference(root, param.schema) ?? (isObject(param.schema) ? param.schema : undefined);
    out.push({
      name: text(param.name) || "",
      location,
      required: Boolean(param.required),
      type: text(schema?.type) || text(param.type) || "string",
      description: text(param.description) || undefined,
      example: text(param.example) || text(schema?.example) || undefined
    });
  }

  return out.filter((param) => Boolean(param.name));
}

function mergeParams(a: ParsedParameter[], b: ParsedParameter[]): ParsedParameter[] {
  const map = new Map<string, ParsedParameter>();
  for (const item of a) {
    map.set(`${item.location}:${item.name}`, item);
  }
  for (const item of b) {
    map.set(`${item.location}:${item.name}`, item);
  }
  return Array.from(map.values());
}

function extractOpenApiRequestBody(rawRequestBody: unknown, root: UnknownRecord): string | undefined {
  const requestBody = resolveReference(root, rawRequestBody);
  if (!requestBody) {
    return undefined;
  }

  const content = asObject(requestBody.content);
  if (!content) {
    return undefined;
  }

  const jsonContent = asObject(content["application/json"]);
  const jsonSchema = resolveReference(root, jsonContent?.schema);
  const jsonExample = jsonContent?.example ?? firstValue(asObject(jsonContent?.examples));

  if (jsonExample !== undefined) {
    return stringifyValue(jsonExample);
  }

  if (jsonSchema) {
    return stringifyValue(jsonSchema);
  }

  const firstType = Object.keys(content)[0];
  const firstContent = asObject(content[firstType]);
  const firstSchema = resolveReference(root, firstContent?.schema);
  if (firstSchema) {
    return stringifyValue(firstSchema);
  }

  const firstExample = firstContent?.example ?? firstValue(asObject(firstContent?.examples));
  if (firstExample !== undefined) {
    return stringifyValue(firstExample);
  }

  return undefined;
}

function extractSwaggerRequestBody(rawParameters: unknown, root: UnknownRecord): string | undefined {
  const parameters = asArray(rawParameters);
  for (const rawParam of parameters) {
    const param = resolveReference(root, rawParam);
    if (!param || text(param.in) !== "body") {
      continue;
    }
    const schema = resolveReference(root, param.schema) ?? param.schema;
    return stringifyValue(schema);
  }
  return undefined;
}

function getOpenApiResponseSchema(response: UnknownRecord): string | undefined {
  const content = asObject(response.content);
  if (!content) {
    return undefined;
  }

  const firstType = Object.keys(content)[0];
  if (!firstType) {
    return undefined;
  }

  const first = asObject(content[firstType]);
  return stringifyValue(first?.schema);
}

function firstOpenApiResponseExample(response: UnknownRecord): string | undefined {
  const content = asObject(response.content);
  if (!content) {
    return undefined;
  }

  for (const contentValue of Object.values(content)) {
    const item = asObject(contentValue);
    if (!item) {
      continue;
    }
    if (item.example !== undefined) {
      return stringifyValue(item.example);
    }
    const examples = asObject(item.examples);
    const exampleValue = firstValue(examples);
    if (exampleValue !== undefined) {
      return stringifyValue(exampleValue);
    }
  }

  return undefined;
}

function firstContentType(rawRequestBody: unknown, root: UnknownRecord): string | undefined {
  const requestBody = resolveReference(root, rawRequestBody);
  if (!requestBody) {
    return undefined;
  }
  const content = asObject(requestBody.content);
  const keys = Object.keys(content ?? {});
  return keys[0];
}

function deriveAuthType(
  security: unknown[],
  schemes: { type: string; name: string; details: Record<string, string> }[]
): string | undefined {
  if (!Array.isArray(security) || security.length === 0) {
    return undefined;
  }

  const firstRequirement = asObject(security[0]);
  if (!firstRequirement) {
    return undefined;
  }

  const firstSchemeName = Object.keys(firstRequirement)[0];
  if (!firstSchemeName) {
    return undefined;
  }

  return schemes.find((scheme) => scheme.name === firstSchemeName)?.type;
}

function getOpenApiBaseUrl(root: UnknownRecord): string {
  const servers = asArray(root.servers);
  const firstServer = asObject(servers[0]);
  return text(firstServer?.url);
}

function getSwaggerBaseUrl(root: UnknownRecord): string {
  const schemes = asArray(root.schemes);
  const scheme = text(schemes[0]) || "https";
  const host = text(root.host);
  const basePath = text(root.basePath);

  if (!host) {
    return "";
  }

  return `${scheme}://${host}${basePath}`;
}

function detectKind(root: UnknownRecord): OpenApiKind | undefined {
  if (text(root.openapi).startsWith("3.")) {
    return "openapi3";
  }
  if (text(root.swagger).startsWith("2.")) {
    return "swagger2";
  }
  return undefined;
}

function parseByExtensionOrContent(filePath: string, raw: string): unknown {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".json") {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Invalid JSON in collection file. Check the file is valid JSON.");
    }
  }

  if (ext === ".yaml" || ext === ".yml") {
    try {
      return yaml.load(raw);
    } catch {
      throw new Error("Invalid YAML syntax in spec file. Check the file is valid YAML.");
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    try {
      return yaml.load(raw);
    } catch {
      throw new Error("Invalid YAML syntax in spec file. Check the file is valid YAML.");
    }
  }
}

function resolveReference(root: UnknownRecord, value: unknown): UnknownRecord | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const ref = value.$ref;
  if (typeof ref !== "string") {
    return value;
  }

  if (!ref.startsWith("#/")) {
    return value;
  }

  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = root;
  for (const part of parts) {
    if (!isObject(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return isObject(current) ? current : undefined;
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown): UnknownRecord | undefined {
  return isObject(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayText(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = value.map((item) => text(item)).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function firstValue(object: UnknownRecord | undefined): unknown {
  if (!object) {
    return undefined;
  }
  const key = Object.keys(object)[0];
  return key ? object[key] : undefined;
}

function firstArrayString(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return text(value[0]);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "endpoint";
}

async function readFileOrThrow(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    throw new Error(`Could not read file: ${filePath}`);
  }
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
