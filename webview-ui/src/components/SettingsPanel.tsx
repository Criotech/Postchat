import { useEffect, useState } from "react";

export type ConfigValues = {
  provider: string;
  anthropicApiKey: string;
  anthropicModel: string;
  openaiApiKey: string;
  openaiModel: string;
  ollamaEndpoint: string;
  ollamaModel: string;
};

type SettingsPanelProps = {
  config: ConfigValues;
  onConfigChange: (key: string, value: string) => void;
};

type FieldProps = {
  label: string;
  value: string;
  type?: "text" | "password";
  placeholder?: string;
  onChange: (v: string) => void;
  onCommit: () => void;
};

function Field({ label, value, type = "text", placeholder, onChange, onCommit }: FieldProps): JSX.Element {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onCommit();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <label className="w-16 shrink-0 text-right text-xs text-vscode-descriptionFg">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={handleKeyDown}
        className="min-w-0 flex-1 rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs text-vscode-inputFg placeholder-vscode-descriptionFg focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
      />
    </div>
  );
}

export function SettingsPanel({ config, onConfigChange }: SettingsPanelProps): JSX.Element {
  const [anthropicApiKey, setAnthropicApiKey] = useState(config.anthropicApiKey);
  const [anthropicModel, setAnthropicModel] = useState(config.anthropicModel);
  const [openaiApiKey, setOpenaiApiKey] = useState(config.openaiApiKey);
  const [openaiModel, setOpenaiModel] = useState(config.openaiModel);
  const [ollamaEndpoint, setOllamaEndpoint] = useState(config.ollamaEndpoint);
  const [ollamaModel, setOllamaModel] = useState(config.ollamaModel);

  // Sync when config changes externally (e.g. VS Code settings)
  useEffect(() => {
    setAnthropicApiKey(config.anthropicApiKey);
    setAnthropicModel(config.anthropicModel);
    setOpenaiApiKey(config.openaiApiKey);
    setOpenaiModel(config.openaiModel);
    setOllamaEndpoint(config.ollamaEndpoint);
    setOllamaModel(config.ollamaModel);
  }, [config]);

  return (
    <div className="border-b border-vscode-panelBorder bg-vscode-editorBg px-3 py-2.5">
      <div className="flex flex-col gap-2">
        {/* Provider selector */}
        <div className="flex items-center gap-2">
          <label className="w-16 shrink-0 text-right text-xs text-vscode-descriptionFg">Provider</label>
          <select
            value={config.provider}
            onChange={(e) => onConfigChange("provider", e.target.value)}
            className="min-w-0 flex-1 rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs text-vscode-inputFg focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama (local)</option>
          </select>
        </div>

        {/* Anthropic fields */}
        {config.provider === "anthropic" && (
          <>
            <Field
              label="API Key"
              type="password"
              value={anthropicApiKey}
              placeholder="sk-ant-..."
              onChange={setAnthropicApiKey}
              onCommit={() => onConfigChange("apiKey", anthropicApiKey)}
            />
            <Field
              label="Model"
              value={anthropicModel}
              placeholder="claude-sonnet-4-5-20250929"
              onChange={setAnthropicModel}
              onCommit={() => onConfigChange("anthropicModel", anthropicModel)}
            />
          </>
        )}

        {/* OpenAI fields */}
        {config.provider === "openai" && (
          <>
            <Field
              label="API Key"
              type="password"
              value={openaiApiKey}
              placeholder="sk-..."
              onChange={setOpenaiApiKey}
              onCommit={() => onConfigChange("openaiApiKey", openaiApiKey)}
            />
            <Field
              label="Model"
              value={openaiModel}
              placeholder="gpt-4o"
              onChange={setOpenaiModel}
              onCommit={() => onConfigChange("openaiModel", openaiModel)}
            />
          </>
        )}

        {/* Ollama fields */}
        {config.provider === "ollama" && (
          <>
            <Field
              label="Endpoint"
              value={ollamaEndpoint}
              placeholder="http://localhost:11434"
              onChange={setOllamaEndpoint}
              onCommit={() => onConfigChange("ollamaEndpoint", ollamaEndpoint)}
            />
            <Field
              label="Model"
              value={ollamaModel}
              placeholder="llama3"
              onChange={setOllamaModel}
              onCommit={() => onConfigChange("ollamaModel", ollamaModel)}
            />
          </>
        )}
      </div>

      <p className="mt-2 text-right text-[10px] text-vscode-descriptionFg opacity-70">
        Press Enter or click away to apply text changes
      </p>
    </div>
  );
}
