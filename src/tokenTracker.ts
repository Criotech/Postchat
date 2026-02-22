export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

type TokenRate = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0
};

export const TOKEN_RATE_MAP: Record<string, Record<string, TokenRate>> = {
  anthropic: {
    "claude-3-5-sonnet": {
      inputPerMillionUsd: 3.0,
      outputPerMillionUsd: 15.0
    }
  },
  openai: {
    "gpt-4o": {
      inputPerMillionUsd: 2.5,
      outputPerMillionUsd: 10.0
    }
  },
  ollama: {
    local: {
      inputPerMillionUsd: 0,
      outputPerMillionUsd: 0
    }
  }
};

function sanitizeTokens(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function resolveRate(provider: string, model: string): TokenRate {
  const normalizedProvider = normalize(provider);
  const normalizedModel = normalize(model);
  const providerRates = TOKEN_RATE_MAP[normalizedProvider];
  if (!providerRates) {
    return { inputPerMillionUsd: 0, outputPerMillionUsd: 0 };
  }

  if (normalizedProvider === "ollama") {
    return providerRates.local ?? { inputPerMillionUsd: 0, outputPerMillionUsd: 0 };
  }

  if (providerRates[normalizedModel]) {
    return providerRates[normalizedModel];
  }

  for (const [modelKey, rate] of Object.entries(providerRates)) {
    if (normalizedModel.startsWith(`${modelKey}-`)) {
      return rate;
    }
  }

  return { inputPerMillionUsd: 0, outputPerMillionUsd: 0 };
}

export class TokenTracker {
  public sessionUsage: TokenUsage = { ...ZERO_USAGE };

  addUsage(input: number, output: number, provider: string, model: string): void {
    const inputTokens = sanitizeTokens(input);
    const outputTokens = sanitizeTokens(output);
    const rate = resolveRate(provider, model);

    const estimatedIncrementUsd =
      (inputTokens * rate.inputPerMillionUsd + outputTokens * rate.outputPerMillionUsd) / 1_000_000;

    this.sessionUsage = {
      inputTokens: this.sessionUsage.inputTokens + inputTokens,
      outputTokens: this.sessionUsage.outputTokens + outputTokens,
      totalTokens: this.sessionUsage.totalTokens + inputTokens + outputTokens,
      estimatedCostUsd: this.sessionUsage.estimatedCostUsd + estimatedIncrementUsd
    };
  }

  reset(): void {
    this.sessionUsage = { ...ZERO_USAGE };
  }

  getUsage(): TokenUsage {
    return { ...this.sessionUsage };
  }
}
