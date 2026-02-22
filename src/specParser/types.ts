export type SpecType = "postman" | "openapi3" | "swagger2" | "unknown";

export type ParsedHeader = { key: string; value: string; enabled: boolean };

export type ParsedParameter = {
  name: string;
  location: "path" | "query" | "header" | "cookie";
  required: boolean;
  type: string;
  description?: string;
  example?: string;
};

export type ParsedResponse = {
  statusCode: string;
  description: string;
  bodySchema?: string;
  example?: string;
};

export type ParsedEndpoint = {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  url: string;
  path: string;
  folder: string;
  description?: string;
  headers: ParsedHeader[];
  parameters: ParsedParameter[];
  requestBody?: string;
  requestContentType?: string;
  responses: ParsedResponse[];
  requiresAuth: boolean;
  authType?: string;
};

export type ParsedCollection = {
  specType: SpecType;
  title: string;
  version?: string;
  baseUrl: string;
  description?: string;
  endpoints: ParsedEndpoint[];
  authSchemes: { type: string; name: string; details: Record<string, string> }[];
  rawSpec?: string;
};
