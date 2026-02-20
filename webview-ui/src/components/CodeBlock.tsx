import { useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  convertSnippet,
  extractRequestFromCodeBlock,
  type ParsedRequest,
  type SnippetFormat
} from "../lib/snippetConverter";

type CodeBlockProps = {
  code: string;
  language: string;
  showSnippetToolbar: boolean;
};

const SNIPPET_FORMATS: SnippetFormat[] = ["curl", "fetch", "axios", "python", "httpie"];
const API_LANGUAGES = new Set(["bash", "sh", "javascript", "python", "http"]);

export function CodeBlock({
  code,
  language,
  showSnippetToolbar
}: CodeBlockProps): JSX.Element {
  const [selectedFormat, setSelectedFormat] = useState<SnippetFormat | null>(inferFormat(code, language));
  const [copied, setCopied] = useState(false);

  const parsedRequest = useMemo(() => {
    const parsed = extractRequestFromCodeBlock(code);
    if (!parsed?.url) {
      return null;
    }
    return {
      method: (parsed.method ?? "GET").toUpperCase(),
      url: parsed.url,
      headers: parsed.headers ?? {},
      body: parsed.body
    } as ParsedRequest;
  }, [code]);

  const isApiLanguage = API_LANGUAGES.has(language.toLowerCase());
  const shouldShowApiToolbar = showSnippetToolbar && (isApiLanguage || Boolean(parsedRequest));
  const canConvert = Boolean(parsedRequest);

  const renderedCode =
    shouldShowApiToolbar && canConvert && selectedFormat
      ? convertSnippet(parsedRequest, selectedFormat)
      : code;

  const renderedLanguage =
    shouldShowApiToolbar && canConvert && selectedFormat
      ? mapFormatToLanguage(selectedFormat)
      : language || "text";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(renderedCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-3 overflow-hidden rounded-md border border-vscode-panelBorder">
      <div className="flex flex-wrap items-center gap-1 border-b border-vscode-panelBorder bg-vscode-editorBg px-2 py-1">
        {shouldShowApiToolbar ? (
          <>
            {SNIPPET_FORMATS.map((format) => (
              <button
                key={format}
                type="button"
                disabled={!canConvert}
                onClick={() => setSelectedFormat(format)}
                className={[
                  "rounded px-1.5 py-0.5 text-[11px] capitalize",
                  selectedFormat === format
                    ? "bg-vscode-buttonSecondaryBg text-vscode-buttonSecondaryFg"
                    : "bg-transparent text-vscode-descriptionFg hover:bg-vscode-listHover",
                  !canConvert ? "cursor-not-allowed opacity-50" : ""
                ].join(" ")}
                title={!canConvert ? "Could not parse request from this block." : `Convert to ${format}`}
              >
                {format}
              </button>
            ))}
          </>
        ) : null}
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto rounded bg-vscode-buttonSecondaryBg px-1.5 py-0.5 text-[11px] text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={renderedLanguage}
        style={vscDarkPlus}
        customStyle={{ margin: 0, fontSize: "0.8rem" }}
      >
        {renderedCode}
      </SyntaxHighlighter>
    </div>
  );
}

function inferFormat(code: string, language: string): SnippetFormat | null {
  const normalizedLanguage = language.toLowerCase();
  const source = code.toLowerCase();

  if (source.includes("axios.")) {
    return "axios";
  }
  if (source.includes("fetch(")) {
    return "fetch";
  }
  if (source.includes("requests.")) {
    return "python";
  }
  if (/^\s*http\s+/i.test(code)) {
    return "httpie";
  }
  if (source.includes("curl ")) {
    return "curl";
  }

  if (normalizedLanguage === "javascript") {
    return "fetch";
  }
  if (normalizedLanguage === "python") {
    return "python";
  }
  if (normalizedLanguage === "http") {
    return "httpie";
  }
  if (normalizedLanguage === "bash" || normalizedLanguage === "sh") {
    return "curl";
  }

  return "curl";
}

function mapFormatToLanguage(format: SnippetFormat): string {
  if (format === "curl") {
    return "bash";
  }
  if (format === "fetch" || format === "axios") {
    return "javascript";
  }
  if (format === "python") {
    return "python";
  }
  return "http";
}
