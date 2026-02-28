export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type ContextFilterStats = {
  totalEndpoints: number;
  sentFull: number;
  sentSummary: number;
  excluded: number;
  estimatedInputTokens: number;
  estimatedCostSavingPercent: number;
  processingTimeMs: number;
  budgetMode: string;
};

type TokenStatusBarProps = {
  usage: TokenUsage;
  provider: string;
  contextStats: ContextFilterStats | null;
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

export function TokenStatusBar({ usage, provider, contextStats }: TokenStatusBarProps): JSX.Element {
  const isOllama = provider.trim().toLowerCase() === "ollama";

  const hasFilter = contextStats !== null && contextStats.excluded > 0;
  const isGlobal = contextStats !== null && contextStats.excluded === 0 && contextStats.sentFull === 0;

  // Build the main status line
  let sessionLabel: string;
  if (contextStats) {
    const shown = contextStats.sentFull + contextStats.sentSummary;
    const tokenPart = `~${formatTokens(contextStats.estimatedInputTokens)} tokens`;
    const costPart = isOllama
      ? "Local (free)"
      : formatEstimatedCost(usage.estimatedCostUsd);
    sessionLabel = `${shown} of ${contextStats.totalEndpoints} endpoints · ${tokenPart} · ${costPart}`;
  } else {
    sessionLabel = isOllama
      ? `Session: ~${formatTokens(usage.totalTokens)} tokens · Local (free)`
      : `Session: ${formatTokens(usage.totalTokens)} tokens · ${formatEstimatedCost(usage.estimatedCostUsd)}`;
  }

  const filterIcon = hasFilter ? "\u26A1" : isGlobal ? "\uD83D\uDCCB" : null;

  return (
    <div className="group relative border-t border-vscode-panelBorder px-3 py-1 text-[11px] text-vscode-descriptionFg">
      <p className="truncate">
        {filterIcon ? (
          <span className="mr-1" title={hasFilter ? "Smart filter active" : "Full collection sent"}>
            {filterIcon}
          </span>
        ) : null}
        {sessionLabel}
      </p>

      <div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-3 right-3 z-20 hidden rounded border border-vscode-panelBorder bg-vscode-editorBg px-2 py-1.5 text-[11px] text-vscode-editorFg shadow-lg group-hover:block">
        {contextStats ? (
          <>
            <p className="font-semibold mb-1">Context Filter Stats</p>
            <p>Endpoints sent: {contextStats.sentFull} full</p>
            <p className="ml-[97px]">{contextStats.sentSummary} summary</p>
            <p className="ml-[97px]">{contextStats.excluded} excluded</p>
            <p>Input: {formatTokens(usage.inputTokens)} tokens</p>
            <p>Output: {formatTokens(usage.outputTokens)} tokens</p>
            <p>Est. context: ~{formatTokens(contextStats.estimatedInputTokens)} tokens</p>
            {!isOllama ? (
              <p>Est. cost: {formatEstimatedCost(usage.estimatedCostUsd)}</p>
            ) : null}
            <p>Saved vs full: ~{contextStats.estimatedCostSavingPercent}%</p>
            <p>Filter time: {contextStats.processingTimeMs}ms</p>
          </>
        ) : (
          <>
            <p>Input: {formatTokens(usage.inputTokens)} tokens</p>
            <p>Output: {formatTokens(usage.outputTokens)} tokens</p>
            <p>Total: {formatTokens(usage.totalTokens)} tokens</p>
            <p className="mt-1 text-vscode-descriptionFg">
              Tokens are small chunks of text. Models read input tokens and generate output tokens.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
