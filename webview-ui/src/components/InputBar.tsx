import { useLayoutEffect, useRef, useState } from "react";

type InputBarProps = {
  onSend: (text: string) => void;
  isThinking: boolean;
};

export function InputBar({ onSend, isThinking }: InputBarProps): JSX.Element {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
  };

  return (
    <div className="border-t border-vscode-panelBorder p-3">
      <div className="flex items-end gap-2 rounded border border-vscode-inputBorder bg-vscode-inputBg p-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
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
