import { useEffect, useRef } from "react";
import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";
import { RequestResult } from "./RequestResult";
import type { ExecutableRequest, ExecutionResult } from "./RequestResult";
import { ThinkingBubble } from "./ThinkingBubble";

type MessageListProps = {
  messages: Message[];
  isThinking: boolean;
  executionResults: Record<string, { request: ExecutableRequest; result: ExecutionResult }>;
  pendingExecutionName: string | null;
  onRunRequest?: (method: string, url: string) => void;
};

export function MessageList({
  messages,
  isThinking,
  executionResults,
  pendingExecutionName,
  onRunRequest
}: MessageListProps): JSX.Element {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isThinking, executionResults]);

  return (
    <main className="flex-1 overflow-y-auto px-3 py-3">
      <div className="flex flex-col gap-3">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} onRunRequest={onRunRequest} />
        ))}

        {pendingExecutionName ? (
          <div className="mr-auto max-w-[90%] rounded-lg border border-vscode-panelBorder bg-vscode-card px-3 py-2 text-sm text-vscode-editorFg opacity-70">
            Running <span className="font-bold">{pendingExecutionName}</span>...
          </div>
        ) : null}

        {Object.entries(executionResults).map(([name, { request, result }]) => (
          <RequestResult key={name} request={request} result={result} />
        ))}

        {isThinking ? <ThinkingBubble /> : null}
        <div ref={bottomRef} />
      </div>
    </main>
  );
}
