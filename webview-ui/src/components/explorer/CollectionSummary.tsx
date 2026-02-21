import { useCallback, useMemo, useState } from "react";
import type { ParsedCollection } from "../../types/spec";

type CollectionSummaryProps = {
  collection: ParsedCollection | null;
};

function getAuthSummary(collection: ParsedCollection): string {
  if (collection.authSchemes.length === 0) {
    return "No";
  }

  const first = collection.authSchemes[0];
  return first.type ? first.type.toUpperCase() : first.name;
}

export function CollectionSummary({ collection }: CollectionSummaryProps): JSX.Element | null {
  const [copied, setCopied] = useState(false);

  const summary = useMemo(() => {
    if (!collection) {
      return null;
    }

    return {
      title: collection.title,
      endpointCount: collection.endpoints.length,
      authType: getAuthSummary(collection),
      baseUrl: collection.baseUrl || "(no base URL)"
    };
  }, [collection]);

  const handleCopyBaseUrl = useCallback(async () => {
    if (!summary || !summary.baseUrl || summary.baseUrl === "(no base URL)") {
      return;
    }

    await navigator.clipboard.writeText(summary.baseUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [summary]);

  if (!summary) {
    return null;
  }

  return (
    <div className="border-b border-vscode-panelBorder bg-vscode-inputBg/40 px-3 py-2 text-xs text-vscode-descriptionFg">
      <span className="font-medium text-vscode-editorFg">{summary.title}</span>
      <span className="mx-1.5 opacity-70">·</span>
      <span>{summary.endpointCount} endpoints</span>
      <span className="mx-1.5 opacity-70">·</span>
      <span>{summary.authType} auth</span>
      <span className="mx-1.5 opacity-70">·</span>
      <button
        type="button"
        onClick={handleCopyBaseUrl}
        className="max-w-[40%] truncate align-bottom text-vscode-linkFg underline decoration-dotted underline-offset-2"
        title={copied ? "Copied" : `Copy base URL: ${summary.baseUrl}`}
      >
        {copied ? "Copied" : summary.baseUrl}
      </button>
    </div>
  );
}
