export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

type TokenStatusBarProps = {
  usage: TokenUsage;
  provider: string;
};

function formatTokens(value: number): string {
  return value.toLocaleString();
}

function formatEstimatedCost(estimatedCostUsd: number): string {
  if (estimatedCostUsd < 0.01) {
    return "<$0.01";
  }
  return `~$${estimatedCostUsd.toFixed(2)}`;
}

export function TokenStatusBar({ usage, provider }: TokenStatusBarProps): JSX.Element {
  const isOllama = provider.trim().toLowerCase() === "ollama";
  const sessionLabel = isOllama
    ? `Session: ~${formatTokens(usage.totalTokens)} tokens · Local (free)`
    : `Session: ${formatTokens(usage.totalTokens)} tokens · ${formatEstimatedCost(usage.estimatedCostUsd)}`;

  return (
    <div className="group relative border-t border-vscode-panelBorder px-3 py-1 text-[11px] text-vscode-descriptionFg">
      <p className="truncate">{sessionLabel}</p>

      <div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-3 right-3 z-20 hidden rounded border border-vscode-panelBorder bg-vscode-editorBg px-2 py-1.5 text-[11px] text-vscode-editorFg shadow-lg group-hover:block">
        <p>Input: {formatTokens(usage.inputTokens)} tokens</p>
        <p>Output: {formatTokens(usage.outputTokens)} tokens</p>
        <p>Total: {formatTokens(usage.totalTokens)} tokens</p>
        <p className="mt-1 text-vscode-descriptionFg">
          Tokens are small chunks of text. Models read input tokens and generate output tokens.
        </p>
      </div>
    </div>
  );
}
