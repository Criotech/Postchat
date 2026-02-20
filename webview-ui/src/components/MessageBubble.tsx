import { useCallback, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import type { Message } from "../types";

type MessageBubbleProps = {
  message: Message;
  onRunRequest?: (method: string, url: string) => void;
};

// Matches METHOD + URL across common markdown formats:
//   GET https://example.com
//   `GET` `https://example.com`
//   **GET** https://example.com
//   [GET] https://example.com
//   **URL:** `https://example.com` (extracts URL, method found separately)
const HTTP_METHOD_URL_PATTERN =
  /[`*[\]]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b[`*[\]]*\s+[`*]*\s*(https?:\/\/[^\s`*,)]+|\/[^\s`*,)]+)/i;

// Fallback: find method and URL on separate lines (e.g., **Method:** GET ... **URL:** `https://...`)
const SEPARATE_METHOD_URL_PATTERN =
  /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b[\s\S]*?\*\*URL:\*\*\s*`([^`]+)`/i;

function createMarkdownComponents(showSnippetToolbar: boolean): Components {
  return {
    p(props) {
      return <p className="my-2 whitespace-pre-wrap break-words" {...props} />;
    },
    ul(props) {
      return <ul className="my-2 list-disc pl-5" {...props} />;
    },
    ol(props) {
      return <ol className="my-2 list-decimal pl-5" {...props} />;
    },
    li(props) {
      return <li className="my-1" {...props} />;
    },
    a(props) {
      return (
        <a
          className="text-vscode-linkFg underline"
          target="_blank"
          rel="noreferrer"
          {...props}
        />
      );
    },
    code({ className, children, ...props }) {
      const isInline = Boolean("inline" in props && props.inline);
      if (isInline) {
        return (
          <code className="rounded bg-vscode-inlineCodeBg px-1 py-0.5 text-xs" {...props}>
            {children}
          </code>
        );
      }

      const match = /language-(\w+)/.exec(className ?? "");
      const language = match?.[1] ?? "text";
      const code = String(children ?? "").replace(/\n$/, "");

      return <CodeBlock code={code} language={language} showSnippetToolbar={showSnippetToolbar} />;
    }
  };
}

export function MessageBubble({ message, onRunRequest }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === "user";
  const markdownComponents = useMemo(() => createMarkdownComponents(!isUser), [isUser]);

  const endpointMatch = useMemo(() => {
    if (isUser) {
      return null;
    }
    return (
      HTTP_METHOD_URL_PATTERN.exec(message.text) ??
      SEPARATE_METHOD_URL_PATTERN.exec(message.text)
    );
  }, [isUser, message.text]);

  const handleRunRequest = useCallback(() => {
    if (endpointMatch && onRunRequest) {
      onRunRequest(endpointMatch[1].toUpperCase(), endpointMatch[2]);
    }
  }, [endpointMatch, onRunRequest]);

  return (
    <article
      className={[
        "max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed",
        isUser
          ? "ml-auto bg-vscode-buttonBg text-vscode-buttonFg"
          : "mr-auto border border-vscode-panelBorder bg-vscode-card text-vscode-editorFg"
      ].join(" ")}
    >
      {isUser ? (
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
      ) : (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.text}
        </ReactMarkdown>
      )}
      {endpointMatch && onRunRequest ? (
        <button
          type="button"
          onClick={handleRunRequest}
          className="mt-2 rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
        >
          ▶ Run this request
        </button>
      ) : null}
    </article>
  );
}
