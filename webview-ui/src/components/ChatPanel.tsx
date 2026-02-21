import type { ConfigValues } from "./SettingsPanel";
import { InputBar } from "./InputBar";
import { MessageList } from "./MessageList";
import type { ExecutableRequest, ExecutionResult } from "./RequestResult";
import { SecretsWarningModal } from "./SecretsWarningModal";
import { SettingsPanel } from "./SettingsPanel";
import { SuggestedPrompts } from "./SuggestedPrompts";
import type { Message } from "../types";
import type { ParsedCollection } from "../types/spec";

type SecretFinding = {
  field: string;
  pattern: string;
  preview: string;
};

type ChatPanelProps = {
  isSettingsOpen: boolean;
  configValues: ConfigValues;
  onConfigChange: (key: string, value: string) => void;
  error?: string;
  showSuggestions: boolean;
  suggestions: string[];
  onSuggestedPrompt: (suggestion: string) => void;
  toastMessage?: string;
  messages: Message[];
  isThinking: boolean;
  executionResults: Record<string, { request: ExecutableRequest; result: ExecutionResult }>;
  pendingExecutionName: string | null;
  onRunRequest: (method: string, url: string) => void;
  onSend: (text: string) => void;
  hasCollection: boolean;
  parsedCollection: ParsedCollection | null;
  programmaticInput: string | null;
  programmaticSendRequest: { id: number; text: string } | null;
  onProgrammaticSendConsumed: () => void;
  isSecretsModalOpen: boolean;
  secretFindings: SecretFinding[];
  onConfirmSend: () => void;
  onCancelSend: () => void;
};

export function ChatPanel({
  isSettingsOpen,
  configValues,
  onConfigChange,
  error,
  showSuggestions,
  suggestions,
  onSuggestedPrompt,
  toastMessage,
  messages,
  isThinking,
  executionResults,
  pendingExecutionName,
  onRunRequest,
  onSend,
  hasCollection,
  parsedCollection,
  programmaticInput,
  programmaticSendRequest,
  onProgrammaticSendConsumed,
  isSecretsModalOpen,
  secretFindings,
  onConfirmSend,
  onCancelSend
}: ChatPanelProps): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {isSettingsOpen ? <SettingsPanel config={configValues} onConfigChange={onConfigChange} /> : null}

      {error ? (
        <div className="mx-3 mt-2 rounded border border-vscode-errorBorder bg-vscode-errorBg px-3 py-2 text-sm text-vscode-errorFg">
          {error}
        </div>
      ) : null}

      {toastMessage ? (
        <div className="mx-3 mt-2 rounded border border-vscode-focusBorder bg-vscode-inputBg px-3 py-2 text-sm text-vscode-editorFg">
          {toastMessage}
        </div>
      ) : null}

      {showSuggestions ? (
        <SuggestedPrompts suggestions={suggestions} onSelect={onSuggestedPrompt} />
      ) : null}

      <MessageList
        messages={messages}
        isThinking={isThinking}
        executionResults={executionResults}
        pendingExecutionName={pendingExecutionName}
        onRunRequest={onRunRequest}
        parsedCollection={parsedCollection}
      />

      <InputBar
        onSend={onSend}
        isThinking={isThinking}
        hasCollection={hasCollection}
        programmaticInput={programmaticInput}
        programmaticSendRequest={programmaticSendRequest}
        onProgrammaticSendConsumed={onProgrammaticSendConsumed}
      />

      {isSecretsModalOpen ? (
        <SecretsWarningModal
          findings={secretFindings}
          onSendAnyway={onConfirmSend}
          onCancel={onCancelSend}
        />
      ) : null}
    </div>
  );
}
