import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { InputBar } from "./components/InputBar";
import { MessageList } from "./components/MessageList";
import type { ExecutableRequest, ExecutionResult } from "./components/RequestResult";
import { SecretsWarningModal } from "./components/SecretsWarningModal";
import { SettingsPanel } from "./components/SettingsPanel";
import type { ConfigValues } from "./components/SettingsPanel";
import { SuggestedPrompts } from "./components/SuggestedPrompts";
import { resolveSlashCommand } from "./lib/slashCommands";
import { vscode } from "./vscode";
import type { Message } from "./types";

type SecretFinding = {
  field: string;
  pattern: string;
  preview: string;
};

type CollectionSpecType = "postman" | "openapi3" | "swagger2";

type IncomingMessage =
  | { command: "addMessage"; role: "user" | "assistant"; text: string }
  | { command: "showThinking"; value: boolean }
  | { command: "showError"; text: string }
  | {
      command: "collectionLoaded";
      name: string;
      path: string;
      specType: CollectionSpecType;
      baseUrl?: string;
      endpointCount?: number;
      authSchemes?: Array<{ type: string; name: string; details: Record<string, string> }>;
      rawSpec?: string;
    }
  | { command: "environmentLoaded"; name: string }
  | { command: "secretsFound"; findings: SecretFinding[] }
  | { command: "showSuggestions"; suggestions: string[] }
  | { command: "clearChat" }
  | { command: "providerChanged"; provider: string; model: string }
  | { command: "requestStarted"; requestName: string }
  | { command: "requestComplete"; result: ExecutionResult; requestName: string }
  | { command: "requestError"; error: string; requestName: string }
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

export default function App(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [collectionName, setCollectionName] = useState<string | undefined>();
  const [collectionPath, setCollectionPath] = useState<string | undefined>();
  const [collectionSpecType, setCollectionSpecType] = useState<CollectionSpecType>("postman");
  const [environmentName, setEnvironmentName] = useState<string | undefined>();
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

  // Request execution state
  const [pendingExecution, setPendingExecution] = useState<ExecutableRequest | null>(null);
  const [executionResults, setExecutionResults] = useState<
    Record<string, { request: ExecutableRequest; result: ExecutionResult }>
  >({});

  const appendMessage = useCallback((role: Message["role"], text: string) => {
    setMessages((prev) => [...prev, { id: createId(), role, text }]);
  }, []);

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
          setCollectionName(message.name);
          setCollectionPath(message.path);
          setCollectionSpecType(message.specType);
          setHasSentFirstMessage(false);
          setError(undefined);
          break;
        case "environmentLoaded":
          setEnvironmentName(message.name);
          setError(undefined);
          break;
        case "showError":
          setError(message.text);
          setIsThinking(false);
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
          break;
        case "requestStarted":
          break;
        case "requestComplete":
          setPendingExecution((prev) => {
            const request = prev ?? {
              name: message.requestName,
              method: "GET",
              url: "",
              headers: {}
            };
            setExecutionResults((prevResults) => ({
              ...prevResults,
              [message.requestName]: { request, result: message.result }
            }));
            return null;
          });
          break;
        case "requestError":
          setPendingExecution(null);
          appendMessage("assistant", `Request **${message.requestName}** failed: ${message.error}`);
          break;
        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [appendMessage]);

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
      setPendingExecution({
        name: `${method} ${url}`,
        method,
        url,
        headers: {}
      });
      vscode.postMessage({ command: "executeRequestByEndpoint", method, url });
    },
    []
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
    vscode.postMessage({ command: "loadCollection" });
  }, []);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setIsThinking(false);
    setError(undefined);
    setPendingExecution(null);
    setExecutionResults({});
    vscode.postMessage({ command: "clearChat" });
  }, []);

  const handleLoadEnvironment = useCallback(() => {
    setError(undefined);
    vscode.postMessage({ command: "loadEnvironment" });
  }, []);

  const handleSettingsToggle = useCallback(() => {
    setIsSettingsOpen((prev) => !prev);
  }, []);

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

  const containerClasses = useMemo(
    () =>
      "flex h-screen w-full flex-col bg-vscode-editorBg text-vscode-editorFg",
    []
  );

  return (
    <div className={containerClasses}>
      <Header
        collectionName={collectionName}
        collectionPath={collectionPath}
        collectionSpecType={collectionSpecType}
        environmentName={environmentName}
        activeProvider={activeProvider}
        activeModel={activeModel}
        isSettingsOpen={isSettingsOpen}
        onLoadCollection={handleLoadCollection}
        onLoadEnvironment={handleLoadEnvironment}
        onClearChat={handleClearChat}
        onSettingsToggle={handleSettingsToggle}
      />

      {isSettingsOpen ? (
        <SettingsPanel config={configValues} onConfigChange={handleConfigChange} />
      ) : null}

      {error ? (
        <div className="mx-3 mt-2 rounded border border-vscode-errorBorder bg-vscode-errorBg px-3 py-2 text-sm text-vscode-errorFg">
          {error}
        </div>
      ) : null}

      {!hasSentFirstMessage && messages.filter((msg) => msg.role === "user").length === 0 ? (
        <SuggestedPrompts suggestions={suggestions} onSelect={handleSuggestedPrompt} />
      ) : null}

      <MessageList
        messages={messages}
        isThinking={isThinking}
        executionResults={executionResults}
        pendingExecutionName={pendingExecution?.name ?? null}
        onRunRequest={handleRunRequestFromBubble}
      />
      <InputBar onSend={handleSend} isThinking={isThinking} hasCollection={Boolean(collectionName)} />
      {isSecretsModalOpen ? (
        <SecretsWarningModal
          findings={secretFindings}
          onSendAnyway={handleConfirmSend}
          onCancel={handleCancelSend}
        />
      ) : null}
    </div>
  );
}
