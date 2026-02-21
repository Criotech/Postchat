import { detectSpecType } from "./detector";
import { parseOpenApi } from "./openApiParser";
import { parsePostman } from "./postmanParser";
import type { ParsedCollection, ParsedEndpoint, SpecType } from "./types";
export type {
  ParsedCollection,
  ParsedEndpoint,
  ParsedHeader,
  ParsedParameter,
  ParsedResponse,
  SpecType
} from "./types";

const UNKNOWN_FORMAT_ERROR =
  "Unrecognized file format. Please select a Postman Collection (.json) or an OpenAPI/Swagger specification (.yaml, .yml, .json).";
export type LoadedParsedCollection = ParsedCollection & {
  specType: Exclude<SpecType, "unknown">;
};

export async function parseSpec(filePath: string): Promise<LoadedParsedCollection> {
  const specType = await detectSpecType(filePath);

  let collection: ParsedCollection;
  if (specType === "postman") {
    collection = await parsePostman(filePath);
  } else if (specType === "openapi3" || specType === "swagger2") {
    collection = await parseOpenApi(filePath);
  } else {
    throw new Error(UNKNOWN_FORMAT_ERROR);
  }

  return validateParsedCollection(collection);
}

export function collectionToMarkdown(collection: ParsedCollection): string {
  const authSummary =
    collection.authSchemes.length === 0
      ? "None"
      : collection.authSchemes
          .map((scheme) => {
            const details = Object.entries(scheme.details)
              .map(([key, value]) => `${key}=${value}`)
              .join(", ");
            return details ? `${scheme.name} (${scheme.type}; ${details})` : `${scheme.name} (${scheme.type})`;
          })
          .join(", ");

  const lines: string[] = [
    `# ${collection.title} API`,
    `Base URL: ${collection.baseUrl || "(not specified)"}`,
    `Auth: ${authSummary}`,
    ""
  ];

  const byFolder = new Map<string, ParsedEndpoint[]>();
  for (const endpoint of collection.endpoints) {
    const folder = endpoint.folder || "General";
    const bucket = byFolder.get(folder);
    if (bucket) {
      bucket.push(endpoint);
    } else {
      byFolder.set(folder, [endpoint]);
    }
  }

  for (const [folder, endpoints] of byFolder.entries()) {
    lines.push(`## ${folder}`, "");

    for (const endpoint of endpoints) {
      const parameterSummary =
        endpoint.parameters.length === 0
          ? "None"
          : endpoint.parameters
              .map(
                (param) =>
                  `\`${param.location}.${param.name}\` (${param.type}, ${param.required ? "required" : "optional"})`
              )
              .join(", ");

      const headerSummary =
        endpoint.headers.length === 0
          ? "None"
          : endpoint.headers
              .filter((header) => header.enabled)
              .map((header) => `\`${header.key}: ${header.value}\``)
              .join(", ") || "None";

      const responseSummary =
        endpoint.responses.length === 0
          ? "None"
          : endpoint.responses
              .map((response) => {
                const body = response.bodySchema || response.example || "";
                return body
                  ? `${response.statusCode} (${response.description}): ${body}`
                  : `${response.statusCode} (${response.description})`;
              })
              .join(", ");

      lines.push(
        `### ${endpoint.method} ${endpoint.name}`,
        `- **URL:** \`${endpoint.url}\``,
        `- **Description:** ${endpoint.description || "None"}`,
        `- **Parameters:** ${parameterSummary}`,
        `- **Headers:** ${headerSummary}`,
        `- **Request Body:** ${formatBodyForMarkdown(endpoint.requestBody)}`,
        `- **Responses:** ${responseSummary}`,
        `- **Auth Required:** ${endpoint.requiresAuth ? "yes" : "no"}`,
        ""
      );
    }
  }

  return lines.join("\n").trim();
}

export function resolveVariables(
  collection: ParsedCollection,
  environment: Record<string, string>
): ParsedCollection {
  const unresolved = new Set<string>();

  const replaceVars = (value: string | undefined): string | undefined => {
    if (!value) {
      return value;
    }

    return value.replace(/{{\s*([^{}\s]+)\s*}}/g, (_match, key: string) => {
      const replacement = environment[key];
      if (replacement === undefined) {
        unresolved.add(key);
        return `{{${key}}}`;
      }
      return replacement;
    });
  };

  const endpoints = collection.endpoints.map((endpoint) => ({
    ...endpoint,
    url: replaceVars(endpoint.url) ?? endpoint.url,
    headers: endpoint.headers.map((header) => ({
      ...header,
      value: replaceVars(header.value) ?? header.value
    })),
    requestBody: replaceVars(endpoint.requestBody),
    responses: endpoint.responses.map((response) => ({
      ...response,
      example: replaceVars(response.example),
      bodySchema: replaceVars(response.bodySchema)
    }))
  }));

  const unresolvedList = Array.from(unresolved.values());
  const warningSuffix =
    unresolvedList.length > 0
      ? ` Unresolved variables: ${unresolvedList.map((name) => `{{${name}}}`).join(", ")}.`
      : "";

  return {
    ...collection,
    baseUrl: replaceVars(collection.baseUrl) ?? collection.baseUrl,
    endpoints,
    description: `${collection.description ?? ""}${warningSuffix}`.trim() || undefined
  };
}

function validateParsedCollection(collection: ParsedCollection): LoadedParsedCollection {
  const validEndpoints = collection.endpoints.filter(
    (endpoint) => Boolean(endpoint.method) && Boolean(endpoint.path)
  );

  let description = collection.description ?? "";

  if (collection.endpoints.length !== validEndpoints.length) {
    const removedCount = collection.endpoints.length - validEndpoints.length;
    description = appendWarning(description, `Filtered ${removedCount} endpoint(s) with empty method/path.`);
  }

  if (validEndpoints.length === 0) {
    console.warn("Parsed collection has no endpoints.");
    description = appendWarning(description, "No endpoints detected in specification.");
  }

  if (!collection.baseUrl) {
    description = appendWarning(description, "Base URL is empty in specification.");
  }

  return {
    ...collection,
    specType: collection.specType as Exclude<SpecType, "unknown">,
    endpoints: validEndpoints,
    description: description || undefined
  };
}

function appendWarning(existing: string, warning: string): string {
  return existing ? `${existing} ${warning}`.trim() : warning;
}

function formatBodyForMarkdown(body: string | undefined): string {
  if (!body) {
    return "None";
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return "None";
  }
  return `\`${trimmed.replace(/`/g, "\\`")}\``;
}
