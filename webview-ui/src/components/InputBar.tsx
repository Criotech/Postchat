import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { COMMANDS } from "../lib/slashCommands";

type InputBarProps = {
  onSend: (text: string) => void;
  isThinking: boolean;
  hasCollection: boolean;
};

export function InputBar({ onSend, isThinking, hasCollection }: InputBarProps): JSX.Element {
  const [value, setValue] = useState("");
  const [isSlashPickerDismissed, setIsSlashPickerDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const slashQuery = useMemo(() => {
    if (!value.startsWith("/")) {
      return "";
    }
    return value.slice(1).trimStart();
  }, [value]);

  const filteredCommands = useMemo(() => {
    if (!value.startsWith("/")) {
      return [];
    }

    const typedCommand = slashQuery.split(/\s+/)[0] ?? "";
    if (!typedCommand) {
      return COMMANDS;
    }

    return COMMANDS.filter((command) => command.name.slice(1).startsWith(typedCommand));
  }, [slashQuery, value]);

  const isSlashPickerVisible =
    value.startsWith("/") && !isSlashPickerDismissed && filteredCommands.length > 0;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const lineHeight = 24;
    const maxHeight = lineHeight * 5;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || isThinking) {
      return;
    }

    onSend(trimmed);
    setValue("");
    setIsSlashPickerDismissed(false);
  };

  const applySlashCommand = (commandName: string) => {
    setValue(`${commandName} `);
    setIsSlashPickerDismissed(false);
    textareaRef.current?.focus();
  };

  const getFirstEnabledCommand = () => {
    return filteredCommands.find((command) => !command.requiresCollection || hasCollection);
  };

  const renderCommandName = (name: string): JSX.Element => {
    const typedCommand = slashQuery.split(/\s+/)[0] ?? "";
    const needle = typedCommand.toLowerCase();
    const haystack = name.toLowerCase();

    if (!needle || !haystack.startsWith(`/${needle}`)) {
      return <>{name}</>;
    }

    const prefix = name.slice(0, needle.length + 1);
    const suffix = name.slice(needle.length + 1);
    return (
      <>
        <span className="font-semibold">{prefix}</span>
        <span>{suffix}</span>
      </>
    );
  };

  return (
    <div className="relative border-t border-vscode-panelBorder p-3">
      {isSlashPickerVisible ? (
        <div className="absolute inset-x-3 bottom-[calc(100%+0.5rem)] z-20 rounded border border-vscode-panelBorder bg-vscode-editorBg p-1 shadow-lg">
          <div className="max-h-56 overflow-y-auto">
            {filteredCommands.map((command) => {
              const disabled = command.requiresCollection && !hasCollection;

              return (
                <button
                  key={command.name}
                  type="button"
                  disabled={disabled}
                  title={
                    disabled
                      ? "Load a collection first to use this command."
                      : command.description
                  }
                  onClick={() => applySlashCommand(command.name)}
                  className="flex w-full items-start gap-3 rounded px-2 py-1.5 text-left hover:bg-vscode-listHover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-sm text-vscode-editorFg">
                    {renderCommandName(command.name)}
                  </span>
                  <span className="text-xs text-vscode-descriptionFg">{command.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex items-end gap-2 rounded border border-vscode-inputBorder bg-vscode-inputBg p-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value;
            setValue(nextValue);

            if (!nextValue.startsWith("/")) {
              setIsSlashPickerDismissed(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (isSlashPickerVisible) {
                event.preventDefault();
                setIsSlashPickerDismissed(true);
              }
              return;
            }

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (isSlashPickerVisible) {
                const command = getFirstEnabledCommand();
                if (command) {
                  applySlashCommand(command.name);
                }
                return;
              }

              submit();
            }
          }}
          rows={1}
          placeholder="Ask about your collection..."
          className="min-h-6 max-h-40 flex-1 resize-none bg-transparent text-sm text-vscode-inputFg placeholder:text-vscode-placeholder focus:outline-none"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || isThinking}
          className="rounded bg-vscode-buttonBg px-3 py-1.5 text-sm font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
