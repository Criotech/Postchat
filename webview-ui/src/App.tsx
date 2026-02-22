import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { ExplorerPanel } from "./components/ExplorerPanel";
import { Header } from "./components/Header";
import type { ExecutableRequest, ExecutionResult } from "./components/RequestResult";
import type { ConfigValues } from "./components/SettingsPanel";
import { useBridgeListener } from "./hooks/useBridgeListener";
import { BridgeProvider, useBridge } from "./lib/explorerBridge";
import { resolveSlashCommand } from "./lib/slashCommands";
import type { ParsedCollection, ParsedEndpoint, SpecType } from "./types/spec";
import { vscode } from "./vscode";
import type { Message } from "./types";

type SecretFinding = {
  field: string;
  pattern: string;
  preview: string;
};

type AppTab = "chat" | "explorer";
type CollectionSpecType = Extract<SpecType, "postman" | "openapi3" | "swagger2">;
type CollectionSummary = {
  id: string;
  path: string;
  name: string;
  specType: CollectionSpecType;
  envName?: string;
};

type ProgrammaticSendRequest = {
  id: number;
  text: string;
};

type IncomingMessage =
  | { command: "addMessage"; role: "user" | "assistant" | "system"; text: string }
  | { command: "showThinking"; value: boolean }
  | { command: "showError"; text: string }
  | {
      command: "collectionLoaded";
      id: string;
      name: string;
      path: string;
      specType: CollectionSpecType;
      envName?: string;
      baseUrl?: string;
      endpointCount?: number;
      authSchemes?: Array<{ type: string; name: string; details: Record<string, string> }>;
      rawSpec?: string;
      activeCollectionId?: string | null;
      collections?: CollectionSummary[];
    }
  | {
      command: "collectionSwitched";
      id: string;
      name: string;
      path: string;
      specType: CollectionSpecType;
      envName?: string;
      baseUrl?: string;
      endpointCount?: number;
      authSchemes?: Array<{ type: string; name: string; details: Record<string, string> }>;
      rawSpec?: string;
      activeCollectionId?: string | null;
      collections?: CollectionSummary[];
    }
  | {
      command: "collectionRemoved";
      id: string;
      activeCollectionId: string | null;
      collections: CollectionSummary[];
    }
  | {
      command: "collectionData";
      collection: ParsedCollection | null;
      activeCollectionId?: string | null;
      collections?: CollectionSummary[];
    }
  | {
      command: "environmentLoaded";
      id: string;
      name: string;
      activeCollectionId?: string | null;
      collections?: CollectionSummary[];
    }
  | { command: "secretsFound"; findings: SecretFinding[] }
  | { command: "showSuggestions"; suggestions: string[] }
  | { command: "clearChat" }
  | { command: "providerChanged"; provider: string; model: string }
  | { command: "requestStarted"; requestName: string }
  | {
      command: "requestComplete";
      result: ExecutionResult;
      requestName: string;
      endpointId?: string;
    }
  | { command: "requestError"; error: string; requestName: string; endpointId?: string }
  | {
      command: "configLoaded";
      provider: string;
      anthropicApiKey: string;
      anthropicModel: string;
      openaiApiKey: string;
      openaiModel: string;
      ollamaEndpoint: string;
      ollamaModel: string;
    };

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildEndpointQuestion(
  endpoint: ParsedEndpoint,
  specType: SpecType | null
): string {
  const detail = endpoint.description?.trim() || `Path: ${endpoint.path}`;

  if (specType === "openapi3" || specType === "swagger2") {
    return `Explain the ${endpoint.method} ${endpoint.name} operation. ${detail}. Include required auth, parameters, and runnable curl + JavaScript examples.`;
  }

  if (endpoint.requiresAuth) {
    return `How do I authenticate and call ${endpoint.method} ${endpoint.name}? ${detail}. Show complete curl and JavaScript fetch examples.`;
  }

  return `How do I use ${endpoint.method} ${endpoint.name}? ${detail}. Include required parameters and a complete request example.`;
}

function setHeaderIfMissing(headers: Record<string, string>, key: string, value: string): void {
  const existingKey = Object.keys(headers).find((headerKey) => headerKey.toLowerCase() === key.toLowerCase());
  if (!existingKey) {
    headers[key] = value;
  }
}

function replacePathTokens(endpoint: ParsedEndpoint): string {
  const pathParamExamples = endpoint.parameters
    .filter((param) => param.location === "path")
    .reduce<Record<string, string>>((acc, param) => {
      if (param.name) {
        acc[param.name] = param.example?.trim() || "sample";
      }
      return acc;
    }, {});

  return endpoint.url.replace(/\{([^{}]+)\}/g, (match, rawName: string, offset: number, whole: string) => {
    const previousChar = offset > 0 ? whole[offset - 1] : "";
    const nextChar = whole[offset + match.length] ?? "";
    if (previousChar === "{" || nextChar === "}") {
      return match;
    }

    const paramName = rawName.trim();
    const replacement = pathParamExamples[paramName];
    return encodeURIComponent(replacement || "sample");
  });
}

function addRequiredQueryParams(endpoint: ParsedEndpoint, urlValue: string): string {
  const requiredQueryParams = endpoint.parameters.filter(
    (param) => param.location === "query" && param.required
  );

  if (requiredQueryParams.length === 0) {
    return urlValue;
  }

  try {
    const parsed = new URL(urlValue);
    for (const param of requiredQueryParams) {
      if (!parsed.searchParams.has(param.name)) {
        parsed.searchParams.set(param.name, param.example?.trim() || "value");
      }
    }
    return parsed.toString();
  } catch {
    const [base, existingQuery = ""] = urlValue.split("?");
    const searchParams = new URLSearchParams(existingQuery);
    for (const param of requiredQueryParams) {
      if (!searchParams.has(param.name)) {
        searchParams.set(param.name, param.example?.trim() || "value");
      }
    }
    const query = searchParams.toString();
    return query ? `${base}?${query}` : base;
  }
}

function addAuthHeaders(
  endpoint: ParsedEndpoint,
  headers: Record<string, string>,
  authSchemes: Array<{ type: string; name: string; details: Record<string, string> }>
): Record<string, string> {
  if (!endpoint.requiresAuth) {
    return headers;
  }

  const next = { ...headers };
  const authType = (endpoint.authType ?? "").toLowerCase();
  const apiKeyScheme =
    authSchemes.find((scheme) => scheme.type.toLowerCase() === "apikey") ??
    authSchemes.find((scheme) => scheme.type.toLowerCase() === authType);

  if (authType === "bearer" || authType === "oauth2") {
    setHeaderIfMissing(next, "Authorization", "Bearer <token>");
  } else if (authType === "basic") {
    setHeaderIfMissing(next, "Authorization", "Basic <base64(username:password)>");
  } else if (authType === "apikey") {
    if (apiKeyScheme?.details.in?.toLowerCase() === "header") {
      setHeaderIfMissing(next, apiKeyScheme.details.name || "X-API-Key", "<api-key>");
    }
  } else {
    setHeaderIfMissing(next, "Authorization", "Bearer <token>");
  }

  return next;
}

function endpointToExecutable(
  endpoint: ParsedEndpoint,
  specType: SpecType | null,
  authSchemes: Array<{ type: string; name: string; details: Record<string, string> }>
): ExecutableRequest {
  const headers = endpoint.headers.reduce<Record<string, string>>((acc, header) => {
    if (header.enabled && header.key.trim().length > 0) {
      acc[header.key] = header.value;
    }
    return acc;
  }, {});

  const isOpenApiLike = specType === "openapi3" || specType === "swagger2";
  const requestUrl = isOpenApiLike
    ? addRequiredQueryParams(endpoint, replacePathTokens(endpoint))
    : endpoint.url;
  const requestHeaders = isOpenApiLike
    ? addAuthHeaders(endpoint, headers, authSchemes)
    : headers;

  return {
    name: endpoint.id,
    method: endpoint.method,
    url: requestUrl,
    headers: requestHeaders,
    body: endpoint.requestBody?.trim() ? endpoint.requestBody : undefined
  };
}

function normalizePath(path: string): string {
  const [withoutQuery] = path.split("?");
  const trimmed = withoutQuery.trim();
  if (trimmed === "/") {
    return "/";
  }
  return trimmed.replace(/\/+$/, "");
}

function splitPathSegments(path: string): string[] {
  return normalizePath(path)
    .split("/")
    .filter((segment) => segment.length > 0);
}

function endpointPathMatches(collectionPath: string, candidatePath: string): boolean {
  const normalizedCollectionPath = normalizePath(collectionPath);
  const normalizedCandidatePath = normalizePath(candidatePath);

  if (normalizedCollectionPath === normalizedCandidatePath) {
    return true;
  }

  const collectionSegments = splitPathSegments(normalizedCollectionPath);
  const candidateSegments = splitPathSegments(normalizedCandidatePath);
  if (collectionSegments.length !== candidateSegments.length) {
    return false;
  }

  for (let index = 0; index < collectionSegments.length; index += 1) {
    const collectionSegment = collectionSegments[index];
    const candidateSegment = candidateSegments[index];
    const isCollectionParam =
      (collectionSegment.startsWith("{") && collectionSegment.endsWith("}")) ||
      collectionSegment.startsWith(":");
    const isCandidateParam =
      (candidateSegment.startsWith("{") && candidateSegment.endsWith("}")) ||
      candidateSegment.startsWith(":");

    if (isCollectionParam || isCandidateParam) {
      continue;
    }
    if (collectionSegment !== candidateSegment) {
      return false;
    }
  }

  return true;
}

function getPathFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return normalizePath(trimmed);
  }

  try {
    return normalizePath(new URL(trimmed).pathname || "/");
  } catch {
    return null;
  }
}

function findMatchingEndpointByMethodAndUrl(
  collection: ParsedCollection | null,
  method: string,
  url: string
): ParsedEndpoint | null {
  if (!collection) {
    return null;
  }

  const candidatePath = getPathFromUrl(url);
  if (!candidatePath) {
    return null;
  }

  const normalizedMethod = method.toUpperCase();
  return (
    collection.endpoints.find(
      (endpoint) =>
        endpoint.method === normalizedMethod && endpointPathMatches(endpoint.path, candidatePath)
    ) ?? null
  );
}

function AppContent(): JSX.Element {
  const { emit } = useBridge();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>("chat");
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [specType, setSpecType] = useState<SpecType | null>(null);
  const [parsedCollection, setParsedCollection] = useState<ParsedCollection | null>(null);
  const [rawSpec, setRawSpec] = useState<string | null>(null);
  const [authSchemes, setAuthSchemes] = useState<
    Array<{ type: string; name: string; details: Record<string, string> }>
  >([]);
  const [activeProvider, setActiveProvider] = useState<string>("anthropic");
  const [activeModel, setActiveModel] = useState<string>("claude-sonnet-4-5");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [configValues, setConfigValues] = useState<ConfigValues>({
    provider: "anthropic",
    anthropicApiKey: "",
    anthropicModel: "claude-sonnet-4-5-20250929",
    openaiApiKey: "",
    openaiModel: "gpt-4o",
    ollamaEndpoint: "http://localhost:11434",
    ollamaModel: "llama3"
  });
  const [error, setError] = useState<string | undefined>();
  const [secretFindings, setSecretFindings] = useState<SecretFinding[]>([]);
  const [isSecretsModalOpen, setIsSecretsModalOpen] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<string | undefined>();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hasSentFirstMessage, setHasSentFirstMessage] = useState(false);
  const [tabToastMessage, setTabToastMessage] = useState<string | undefined>();
  const [isCollectionParsing, setIsCollectionParsing] = useState(false);

  const [programmaticInput, setProgrammaticInput] = useState<string | null>(null);
  const [programmaticSendRequest, setProgrammaticSendRequest] = useState<ProgrammaticSendRequest | null>(null);

  const tabToastTimeoutRef = useRef<number | null>(null);
  const parsingTimeoutRef = useRef<number | null>(null);
  const bridgeTimeoutIdsRef = useRef<number[]>([]);
  const bridgeSendCounterRef = useRef(0);
  const activeTabRef = useRef<AppTab>("chat");
  const activeCollectionIdRef = useRef<string | null>(null);
  const bridgeRequestEndpointMapRef = useRef<Record<string, string>>({});

  // Request execution state
  const [pendingExecution, setPendingExecution] = useState<ExecutableRequest | null>(null);
  const [executionResults, setExecutionResults] = useState<
    Record<string, { request: ExecutableRequest; result: ExecutionResult; endpointId?: string | null }>
  >({});

  const appendMessage = useCallback((role: Message["role"], text: string) => {
    setMessages((prev) => [...prev, { id: createId(), role, text }]);
  }, []);

  const appendSystemMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: createId(), role: "system", text }]);
  }, []);

  const setAppTab = useCallback((tab: AppTab) => {
    activeTabRef.current = tab;
    setActiveTab(tab);
  }, []);

  const clearBridgeTimers = useCallback(() => {
    for (const timerId of bridgeTimeoutIdsRef.current) {
      window.clearTimeout(timerId);
    }
    bridgeTimeoutIdsRef.current = [];
  }, []);

  const clearParsingTimer = useCallback(() => {
    if (parsingTimeoutRef.current !== null) {
      window.clearTimeout(parsingTimeoutRef.current);
      parsingTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    activeCollectionIdRef.current = activeCollectionId;
  }, [activeCollectionId]);

  const activeCollection = useMemo(
    () => collections.find((item) => item.id === activeCollectionId) ?? null,
    [activeCollectionId, collections]
  );

  useBridgeListener(
    (event) => {
      switch (event.type) {
        case "switchToChat":
          setAppTab("chat");
          return;
        case "switchToExplorer":
          setAppTab("explorer");
          return;
        case "askAboutEndpoint": {
          const question = buildEndpointQuestion(event.endpoint, parsedCollection?.specType ?? specType);
          clearBridgeTimers();
          setAppTab("chat");
          setProgrammaticInput(null);

          const fillTimer = window.setTimeout(() => {
            setProgrammaticInput(question);
          }, 150);

          const sendTimer = window.setTimeout(() => {
            bridgeSendCounterRef.current += 1;
            setProgrammaticSendRequest({ id: bridgeSendCounterRef.current, text: question });
          }, 300);

          bridgeTimeoutIdsRef.current.push(fillTimer, sendTimer);
          return;
        }
        case "runEndpoint": {
          const request = endpointToExecutable(
            event.endpoint,
            parsedCollection?.specType ?? specType,
            parsedCollection?.authSchemes ?? authSchemes
          );
          bridgeRequestEndpointMapRef.current[request.name] = event.endpoint.id;
          setPendingExecution(request);
          setExecutionResults((prev) => {
            const next = { ...prev };
            delete next[request.name];
            return next;
          });

          vscode.postMessage({ command: "executeRequest", request });
          emit({ type: "executionStarted", endpointId: event.endpoint.id });
          return;
        }
        case "highlightEndpoint":
          if (activeTabRef.current !== "explorer") {
            setAppTab("explorer");
            const replayTimer = window.setTimeout(() => {
              emit({ type: "highlightEndpoint", endpointId: event.endpointId });
            }, 250);
            const retryTimer = window.setTimeout(() => {
              emit({ type: "highlightEndpoint", endpointId: event.endpointId });
            }, 600);
            bridgeTimeoutIdsRef.current.push(replayTimer, retryTimer);
          }
          return;
        default:
          return;
      }
    },
    [authSchemes, clearBridgeTimers, emit, parsedCollection, setAppTab, specType]
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent<IncomingMessage>) => {
      const message = event.data;
      if (!message || typeof message !== "object" || !("command" in message)) {
        return;
      }

      switch (message.command) {
        case "addMessage":
          appendMessage(message.role, message.text);
          if (message.role === "assistant") {
            setIsThinking(false);
          }
          setError(undefined);
          break;
        case "showThinking":
          setIsThinking(message.value);
          break;
        case "collectionLoaded":
          clearParsingTimer();
          setIsCollectionParsing(true);
          parsingTimeoutRef.current = window.setTimeout(() => {
            setIsCollectionParsing(false);
            parsingTimeoutRef.current = null;
          }, 8000);
          setCollections((prev) => {
            if (message.collections) {
              return message.collections;
            }
            const others = prev.filter((item) => item.id !== message.id);
            return [
              ...others,
              {
                id: message.id,
                path: message.path,
                name: message.name,
                specType: message.specType,
                envName: message.envName
              }
            ];
          });
          setActiveCollectionId(message.activeCollectionId ?? message.id);
          setSpecType(message.specType);
          setAuthSchemes(message.authSchemes ?? []);
          setRawSpec(
            message.specType === "openapi3" || message.specType === "swagger2"
              ? message.rawSpec ?? null
              : null
          );
          setParsedCollection(null);
          setHasSentFirstMessage(false);
          setError(undefined);
          setProgrammaticInput(null);
          setProgrammaticSendRequest(null);
          bridgeRequestEndpointMapRef.current = {};
          vscode.postMessage({ command: "getCollectionData" });
          break;
        case "collectionSwitched": {
          const previousActiveId = activeCollectionIdRef.current;
          clearParsingTimer();
          setIsCollectionParsing(true);
          parsingTimeoutRef.current = window.setTimeout(() => {
            setIsCollectionParsing(false);
            parsingTimeoutRef.current = null;
          }, 8000);
          setCollections((prev) => message.collections ?? prev);
          setActiveCollectionId(message.activeCollectionId ?? message.id);
          setSpecType(message.specType);
          setAuthSchemes(message.authSchemes ?? []);
          setRawSpec(
            message.specType === "openapi3" || message.specType === "swagger2"
              ? message.rawSpec ?? null
              : null
          );
          setParsedCollection(null);
          setSuggestions([]);
          setHasSentFirstMessage(false);
          setError(undefined);
          setProgrammaticInput(null);
          setProgrammaticSendRequest(null);
          bridgeRequestEndpointMapRef.current = {};
          if (previousActiveId && previousActiveId !== message.id) {
            appendSystemMessage(`Switched to: ${message.name}`);
          }
          vscode.postMessage({ command: "getCollectionData" });
          break;
        }
        case "collectionRemoved":
          setCollections(message.collections);
          setActiveCollectionId(message.activeCollectionId);
          if (!message.activeCollectionId) {
            setSpecType(null);
            setAuthSchemes([]);
            setRawSpec(null);
            setParsedCollection(null);
            setSuggestions([]);
          }
          setError(undefined);
          break;
        case "collectionData":
          if (message.collections) {
            setCollections(message.collections);
          }
          if (message.activeCollectionId !== undefined) {
            setActiveCollectionId(message.activeCollectionId);
          }
          setParsedCollection(message.collection);
          setIsCollectionParsing(false);
          clearParsingTimer();
          if (message.collection) {
            setSpecType(message.collection.specType);
            setAuthSchemes(message.collection.authSchemes ?? []);
            if (
              (message.collection.specType === "openapi3" ||
                message.collection.specType === "swagger2") &&
              message.collection.rawSpec
            ) {
              setRawSpec(message.collection.rawSpec);
            } else if (message.collection.specType === "postman") {
              setRawSpec(null);
            }
          } else {
            setRawSpec(null);
            setAuthSchemes([]);
            setSpecType(null);
          }
          break;
        case "environmentLoaded":
          setCollections((prev) =>
            message.collections
              ? message.collections
              : prev.map((item) =>
                  item.id === message.id ? { ...item, envName: message.name } : item
                )
          );
          if (message.activeCollectionId !== undefined) {
            setActiveCollectionId(message.activeCollectionId);
          }
          setError(undefined);
          break;
        case "showError":
          setError(message.text);
          setIsThinking(false);
          setIsCollectionParsing(false);
          clearParsingTimer();
          break;
        case "secretsFound":
          setSecretFindings(message.findings);
          setIsSecretsModalOpen(true);
          setIsThinking(false);
          setError(undefined);
          break;
        case "showSuggestions":
          setSuggestions(message.suggestions);
          break;
        case "providerChanged":
          setActiveProvider(message.provider);
          setActiveModel(message.model);
          break;
        case "configLoaded":
          setConfigValues({
            provider: message.provider,
            anthropicApiKey: message.anthropicApiKey,
            anthropicModel: message.anthropicModel,
            openaiApiKey: message.openaiApiKey,
            openaiModel: message.openaiModel,
            ollamaEndpoint: message.ollamaEndpoint,
            ollamaModel: message.ollamaModel
          });
          break;
        case "clearChat":
          setMessages([]);
          setError(undefined);
          setIsThinking(false);
          setIsSecretsModalOpen(false);
          setSecretFindings([]);
          setQueuedMessage(undefined);
          setSuggestions([]);
          setHasSentFirstMessage(false);
          setPendingExecution(null);
          setExecutionResults({});
          setProgrammaticInput(null);
          setProgrammaticSendRequest(null);
          bridgeRequestEndpointMapRef.current = {};
          setIsCollectionParsing(false);
          clearParsingTimer();
          break;
        case "requestStarted":
          break;
        case "requestComplete": {
          const resolvedEndpointId =
            message.endpointId ??
            bridgeRequestEndpointMapRef.current[message.requestName] ??
            null;

          setPendingExecution((prev) => {
            const request = prev ?? {
              name: message.requestName,
              method: "GET",
              url: "",
              headers: {}
            };
            setExecutionResults((prevResults) => ({
              ...prevResults,
              [message.requestName]: { request, result: message.result, endpointId: resolvedEndpointId }
            }));
            return null;
          });

          emit({
            type: "executionComplete",
            endpointId: resolvedEndpointId ?? message.requestName,
            result: message.result
          });
          delete bridgeRequestEndpointMapRef.current[message.requestName];
          break;
        }
        case "requestError": {
          const endpointId =
            message.endpointId ??
            bridgeRequestEndpointMapRef.current[message.requestName] ??
            message.requestName;

          setPendingExecution(null);
          emit({ type: "executionError", endpointId, error: message.error });
          delete bridgeRequestEndpointMapRef.current[message.requestName];

          appendMessage("assistant", `Request **${message.requestName}** failed: ${message.error}`);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [appendMessage, appendSystemMessage, clearParsingTimer, emit]);

  useEffect(() => {
    const handleSwitchTab = (event: Event) => {
      const customEvent = event as CustomEvent<{ tab?: AppTab }>;
      const nextTab = customEvent.detail?.tab;
      if (nextTab === "chat" || nextTab === "explorer") {
        setAppTab(nextTab);
      }
    };

    window.addEventListener("postchat:switchTab", handleSwitchTab as EventListener);
    return () => window.removeEventListener("postchat:switchTab", handleSwitchTab as EventListener);
  }, [setAppTab]);

  useEffect(() => {
    vscode.postMessage({ command: "getCollectionData" });
  }, []);

  useEffect(() => {
    return () => {
      if (tabToastTimeoutRef.current !== null) {
        window.clearTimeout(tabToastTimeoutRef.current);
      }
      clearParsingTimer();
      clearBridgeTimers();
      bridgeRequestEndpointMapRef.current = {};
    };
  }, [clearBridgeTimers, clearParsingTimer]);

  const handleExecuteRequest = useCallback((request: ExecutableRequest) => {
    setPendingExecution(request);
    // Remove stale result for re-runs
    setExecutionResults((prev) => {
      const next = { ...prev };
      delete next[request.name];
      return next;
    });
    vscode.postMessage({ command: "executeRequest", request });
  }, []);

  const handleRunRequestFromBubble = useCallback(
    (method: string, url: string) => {
      const requestName = `${method} ${url}`;
      const matchingEndpoint = findMatchingEndpointByMethodAndUrl(parsedCollection, method, url);
      if (matchingEndpoint) {
        bridgeRequestEndpointMapRef.current[requestName] = matchingEndpoint.id;
        bridgeRequestEndpointMapRef.current[matchingEndpoint.name] = matchingEndpoint.id;
      }

      setPendingExecution({ name: requestName, method, url, headers: {} });
      vscode.postMessage({ command: "executeRequestByEndpoint", method, url });
    },
    [parsedCollection]
  );

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isThinking) {
        return;
      }

      setError(undefined);

      const command = resolveSlashCommand(trimmed);
      if (command === "/summarize") {
        const transformed =
          "Give me a high-level summary of this API collection. List the main resource groups, total number of endpoints, and the base URL.";
        setHasSentFirstMessage(true);
        setQueuedMessage(transformed);
        vscode.postMessage({ command: "sendMessage", text: transformed });
        return;
      }

      if (command === "/auth") {
        const transformed =
          "Explain the authentication mechanism used in this collection step by step. Include code examples for obtaining and using a token.";
        setHasSentFirstMessage(true);
        setQueuedMessage(transformed);
        vscode.postMessage({ command: "sendMessage", text: transformed });
        return;
      }

      if (command === "/find") {
        const keyword = trimmed.replace(/^\/find\b/i, "").trim();
        const transformed = `Find all requests related to: ${
          keyword || "all endpoints"
        }. List each matching endpoint with its method and URL.`;
        setHasSentFirstMessage(true);
        setQueuedMessage(transformed);
        vscode.postMessage({ command: "sendMessage", text: transformed });
        return;
      }

      if (command === "/run") {
        const requestName = trimmed.replace(/^\/run\b/i, "").trim();
        setHasSentFirstMessage(true);
        vscode.postMessage({ command: "runRequest", requestName });
        return;
      }

      if (command === "/export") {
        vscode.postMessage({ command: "exportChat" });
        return;
      }

      setQueuedMessage(trimmed);
      setHasSentFirstMessage(true);
      vscode.postMessage({ command: "sendMessage", text: trimmed });
    },
    [isThinking]
  );

  const handleLoadCollection = useCallback(() => {
    setError(undefined);
    setSuggestions([]);
    setHasSentFirstMessage(false);
    setIsCollectionParsing(true);
    clearParsingTimer();
    parsingTimeoutRef.current = window.setTimeout(() => {
      setIsCollectionParsing(false);
      parsingTimeoutRef.current = null;
    }, 8000);
    vscode.postMessage({ command: "loadCollection" });
  }, [clearParsingTimer]);

  const handleSwitchCollection = useCallback(
    (id: string) => {
      if (!id || id === activeCollectionIdRef.current) {
        return;
      }
      setError(undefined);
      setSuggestions([]);
      setHasSentFirstMessage(false);
      setIsCollectionParsing(true);
      clearParsingTimer();
      parsingTimeoutRef.current = window.setTimeout(() => {
        setIsCollectionParsing(false);
        parsingTimeoutRef.current = null;
      }, 8000);
      vscode.postMessage({ command: "switchCollection", id });
    },
    [clearParsingTimer]
  );

  const handleRemoveCollection = useCallback((id: string) => {
    if (!id) {
      return;
    }
    setError(undefined);
    setSuggestions([]);
    vscode.postMessage({ command: "removeCollection", id });
  }, []);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setIsThinking(false);
    setError(undefined);
    setIsCollectionParsing(false);
    clearParsingTimer();
    setPendingExecution(null);
    setExecutionResults({});
    setProgrammaticInput(null);
    setProgrammaticSendRequest(null);
    bridgeRequestEndpointMapRef.current = {};
    vscode.postMessage({ command: "clearChat" });
  }, [clearParsingTimer]);

  const handleLoadEnvironment = useCallback(() => {
    setError(undefined);
    vscode.postMessage({ command: "loadEnvironment" });
  }, []);

  const handleSettingsToggle = useCallback(() => {
    setIsSettingsOpen((prev) => !prev);
  }, []);

  const handleTabChange = useCallback(
    (tab: AppTab) => {
      if (tab === "explorer" && !activeCollection && !isCollectionParsing) {
        setTabToastMessage("Load a Postman collection or OpenAPI spec to use the Explorer");
        if (tabToastTimeoutRef.current !== null) {
          window.clearTimeout(tabToastTimeoutRef.current);
        }
        tabToastTimeoutRef.current = window.setTimeout(() => {
          setTabToastMessage(undefined);
          tabToastTimeoutRef.current = null;
        }, 2500);
        return;
      }

      setAppTab(tab);
      setTabToastMessage(undefined);
    },
    [activeCollection, isCollectionParsing, setAppTab]
  );

  const handleConfigChange = useCallback((key: string, value: string) => {
    // Map VS Code setting keys to local ConfigValues keys where they differ
    const localKey = key === "apiKey" ? "anthropicApiKey" : key;
    setConfigValues((prev) => ({ ...prev, [localKey]: value }));
    vscode.postMessage({ command: "updateConfig", key, value });
  }, []);

  const handleSuggestedPrompt = useCallback(
    (suggestion: string) => {
      handleSend(suggestion);
    },
    [handleSend]
  );

  const handleConfirmSend = useCallback(() => {
    if (!queuedMessage) {
      return;
    }
    setIsSecretsModalOpen(false);
    setSecretFindings([]);
    vscode.postMessage({ command: "confirmSend", originalMessage: queuedMessage });
  }, [queuedMessage]);

  const handleCancelSend = useCallback(() => {
    setIsSecretsModalOpen(false);
    setSecretFindings([]);
    setQueuedMessage(undefined);
    vscode.postMessage({ command: "cancelSend" });
  }, []);

  const handleSendToAiFromResponse = useCallback(
    (prompt: string) => {
      setAppTab("chat");
      handleSend(prompt);
    },
    [handleSend, setAppTab]
  );

  const showSuggestions = useMemo(
    () => !hasSentFirstMessage && Boolean(activeCollectionId),
    [activeCollectionId, hasSentFirstMessage]
  );

  return (
    <div className="flex flex-col h-screen bg-vscode-editorBg text-vscode-editorFg">
      <Header
        activeTab={activeTab}
        collections={collections}
        activeCollectionId={activeCollectionId}
        isCollectionParsing={isCollectionParsing}
        activeProvider={activeProvider}
        activeModel={activeModel}
        isSettingsOpen={isSettingsOpen}
        onTabChange={handleTabChange}
        onLoadCollection={handleLoadCollection}
        onSwitchCollection={handleSwitchCollection}
        onRemoveCollection={handleRemoveCollection}
        onLoadEnvironment={handleLoadEnvironment}
        onClearChat={handleClearChat}
        onSettingsToggle={handleSettingsToggle}
      />

      <main className="flex-1 overflow-hidden">
        {activeTab === "chat" ? (
          <div className="h-full transition-opacity duration-150 postchat-fade-in">
            <ChatPanel
              isSettingsOpen={isSettingsOpen}
              configValues={configValues}
              onConfigChange={handleConfigChange}
              error={error}
              showSuggestions={showSuggestions}
              suggestions={suggestions}
              onSuggestedPrompt={handleSuggestedPrompt}
              toastMessage={tabToastMessage}
              messages={messages}
              isThinking={isThinking}
              executionResults={executionResults}
              pendingExecutionName={pendingExecution?.name ?? null}
              onRunRequest={handleRunRequestFromBubble}
              onSend={handleSend}
              hasCollection={Boolean(activeCollectionId)}
              parsedCollection={parsedCollection}
              programmaticInput={programmaticInput}
              programmaticSendRequest={programmaticSendRequest}
              onProgrammaticSendConsumed={() => setProgrammaticSendRequest(null)}
              isSecretsModalOpen={isSecretsModalOpen}
              secretFindings={secretFindings}
              onConfirmSend={handleConfirmSend}
              onCancelSend={handleCancelSend}
            />
          </div>
        ) : null}

        {activeTab === "explorer" ? (
          <div className="h-full transition-opacity duration-150 postchat-fade-in">
            <ExplorerPanel
              key={activeCollectionId ?? "no-collection"}
              parsedCollection={parsedCollection}
              rawSpec={rawSpec}
              specType={specType}
              onSendToAI={handleSendToAiFromResponse}
              isParsing={isCollectionParsing}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <BridgeProvider>
      <AppContent />
    </BridgeProvider>
  );
}
