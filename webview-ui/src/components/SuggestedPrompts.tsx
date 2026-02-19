import { useEffect, useState } from "react";

type SuggestedPromptsProps = {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
};

export function SuggestedPrompts({ suggestions, onSelect }: SuggestedPromptsProps): JSX.Element {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div
      className={`mx-3 mt-2 rounded border border-vscode-panelBorder bg-vscode-inputBg/50 p-2 transition-opacity duration-300 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="mb-2 text-xs text-vscode-descriptionFg">Suggested questions</div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSelect(suggestion)}
            className="rounded-full border border-vscode-inputBorder bg-vscode-editorBg px-3 py-1 text-xs text-vscode-inputFg hover:bg-vscode-listHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
