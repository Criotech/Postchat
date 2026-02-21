import type { ParsedCollection, ParsedEndpoint } from "../types/spec";

export type KeyValueRow = {
  key: string;
  value: string;
  enabled: boolean;
};

export type RequestEditState = {
  method: string;
  url: string;
  pathParams: Record<string, string>;
  queryParams: KeyValueRow[];
  headers: KeyValueRow[];
  body: string;
  contentType: string;
  authType: string;
  authValue: string;
};

export type ExecutionResult = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
};

export type ExecutableRequest = {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export type LoadEndpointMessage = {
  command: "loadEndpoint";
  endpoint: ParsedEndpoint;
  collection: ParsedCollection | null;
  environmentVariables?: Record<string, string>;
};

export type RequestTabIncomingMessage =
  | LoadEndpointMessage
  | { command: "requestComplete"; result: ExecutionResult }
  | { command: "requestError"; error: string }
  | { command: "aiResponse"; text: string }
  | { command: "askAIResponse"; text: string }
  | { command: "askAIError"; error: string }
  | { command: "showThinking"; value: boolean };
