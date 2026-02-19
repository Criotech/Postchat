import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { InputBar } from "./components/InputBar";
import { MessageList } from "./components/MessageList";
import { SecretsWarningModal } from "./components/SecretsWarningModal";
import { vscode } from "./vscode";
import type { Message } from "./types";

type SecretFinding = {
  field: string;
  pattern: string;
  preview: string;
};

type IncomingMessage =
  | { command: "addMessage"; role: "user" | "assistant"; text: string }
  | { command: "showThinking"; value: boolean }
  | { command: "showError"; text: string }
  | { command: "collectionLoaded"; name: string }
  | { command: "environmentLoaded"; name: string }
  | { command: "secretsFound"; findings: SecretFinding[] }
  | { command: "clearChat" };

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
  const [environmentName, setEnvironmentName] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [secretFindings, setSecretFindings] = useState<SecretFinding[]>([]);
  const [isSecretsModalOpen, setIsSecretsModalOpen] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<string | undefined>();

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
        case "clearChat":
          setMessages([]);
          setError(undefined);
          setIsThinking(false);
          setIsSecretsModalOpen(false);
          setSecretFindings([]);
          setQueuedMessage(undefined);
          break;
        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [appendMessage]);

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isThinking) {
        return;
      }

      setError(undefined);
      setQueuedMessage(trimmed);
      vscode.postMessage({ command: "sendMessage", text: trimmed });
    },
    [isThinking]
  );

  const handleLoadCollection = useCallback(() => {
    setError(undefined);
    vscode.postMessage({ command: "loadCollection" });
  }, []);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setIsThinking(false);
    setError(undefined);
    vscode.postMessage({ command: "clearChat" });
  }, []);

  const handleLoadEnvironment = useCallback(() => {
    setError(undefined);
    vscode.postMessage({ command: "loadEnvironment" });
  }, []);

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
        environmentName={environmentName}
        onLoadCollection={handleLoadCollection}
        onLoadEnvironment={handleLoadEnvironment}
        onClearChat={handleClearChat}
      />

      {error ? (
        <div className="mx-3 mt-2 rounded border border-vscode-errorBorder bg-vscode-errorBg px-3 py-2 text-sm text-vscode-errorFg">
          {error}
        </div>
      ) : null}

      <MessageList messages={messages} isThinking={isThinking} />
      <InputBar onSend={handleSend} isThinking={isThinking} />
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
