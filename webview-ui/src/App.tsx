import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { InputBar } from "./components/InputBar";
import { MessageList } from "./components/MessageList";
import { vscode } from "./vscode";
import type { Message } from "./types";

type IncomingMessage =
  | { command: "addMessage"; role: "user" | "assistant"; text: string }
  | { command: "showThinking"; value: boolean }
  | { command: "showError"; text: string }
  | { command: "collectionLoaded"; name: string }
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
  const [error, setError] = useState<string | undefined>();

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
        case "showError":
          setError(message.text);
          setIsThinking(false);
          break;
        case "clearChat":
          setMessages([]);
          setError(undefined);
          setIsThinking(false);
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

  const containerClasses = useMemo(
    () =>
      "flex h-screen w-full flex-col bg-vscode-editorBg text-vscode-editorFg",
    []
  );

  return (
    <div className={containerClasses}>
      <Header
        collectionName={collectionName}
        onLoadCollection={handleLoadCollection}
        onClearChat={handleClearChat}
      />

      {error ? (
        <div className="mx-3 mt-2 rounded border border-vscode-errorBorder bg-vscode-errorBg px-3 py-2 text-sm text-vscode-errorFg">
          {error}
        </div>
      ) : null}

      <MessageList messages={messages} isThinking={isThinking} />
      <InputBar onSend={handleSend} isThinking={isThinking} />
    </div>
  );
}
