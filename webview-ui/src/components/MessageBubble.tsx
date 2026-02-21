import { useCallback, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useBridge } from "../lib/explorerBridge";
import type { Message } from "../types";
import type { ParsedCollection } from "../types/spec";
import { CodeBlock } from "./CodeBlock";

type MessageBubbleProps = {
  message: Message;
  onRunRequest?: (method: string, url: string) => void;
  parsedCollection?: ParsedCollection | null;
};

type ExtractedEndpointMention = {
  method: string;
  path: string;
  label: string;
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

const EXPLORER_ENDPOINT_PATTERN = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+([\/][^\s,)]+)/gi;

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

function normalizePath(path: string): string {
  const [withoutQuery] = path.split("?");
  const trimmed = withoutQuery.trim();
  if (trimmed === "/") {
    return "/";
  }
  return trimmed.replace(/\/+$/, "");
}

function splitPathSegments(path: string): string[] {
  return normalizePath(path)
    .split("/")
    .filter((segment) => segment.length > 0);
}

function endpointPathMatches(collectionPath: string, mentionedPath: string): boolean {
  const normalizedCollectionPath = normalizePath(collectionPath);
  const normalizedMentionedPath = normalizePath(mentionedPath);

  if (normalizedCollectionPath === normalizedMentionedPath) {
    return true;
  }

  const collectionSegments = splitPathSegments(normalizedCollectionPath);
  const mentionedSegments = splitPathSegments(normalizedMentionedPath);

  if (collectionSegments.length !== mentionedSegments.length) {
    return false;
  }

  for (let index = 0; index < collectionSegments.length; index += 1) {
    const collectionSegment = collectionSegments[index];
    const mentionedSegment = mentionedSegments[index];

    if (collectionSegment.startsWith("{") && collectionSegment.endsWith("}")) {
      continue;
    }

    if (collectionSegment !== mentionedSegment) {
      return false;
    }
  }

  return true;
}

function extractEndpointMentions(text: string): ExtractedEndpointMention[] {
  EXPLORER_ENDPOINT_PATTERN.lastIndex = 0;

  const matches: ExtractedEndpointMention[] = [];
  const dedupe = new Set<string>();

  let match = EXPLORER_ENDPOINT_PATTERN.exec(text);
  while (match) {
    const method = (match[1] ?? "").toUpperCase();
    const path = normalizePath(match[2] ?? "");
    if (method && path) {
      const key = `${method} ${path}`;
      if (!dedupe.has(key)) {
        dedupe.add(key);
        matches.push({ method, path, label: key });
      }
    }
    match = EXPLORER_ENDPOINT_PATTERN.exec(text);
  }

  return matches;
}

export function MessageBubble({ message, onRunRequest, parsedCollection }: MessageBubbleProps): JSX.Element {
  const { emit } = useBridge();
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

  const endpointMentions = useMemo(() => {
    if (isUser || !parsedCollection) {
      return [];
    }
    return extractEndpointMentions(message.text);
  }, [isUser, message.text, parsedCollection]);

  const handleRunRequest = useCallback(() => {
    if (endpointMatch && onRunRequest) {
      onRunRequest(endpointMatch[1].toUpperCase(), endpointMatch[2]);
    }
  }, [endpointMatch, onRunRequest]);

  const handleViewInExplorer = useCallback(
    (mention: ExtractedEndpointMention) => {
      if (!parsedCollection) {
        emit({ type: "switchToExplorer" });
        return;
      }

      const matchingEndpoint = parsedCollection.endpoints.find(
        (endpoint) =>
          endpoint.method === mention.method && endpointPathMatches(endpoint.path, mention.path)
      );

      if (matchingEndpoint) {
        emit({ type: "highlightEndpoint", endpointId: matchingEndpoint.id });
        return;
      }

      emit({ type: "switchToExplorer" });
    },
    [emit, parsedCollection]
  );

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

      {!isUser && parsedCollection && endpointMentions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {endpointMentions.map((mention) => (
            <button
              key={mention.label}
              type="button"
              onClick={() => handleViewInExplorer(mention)}
              className="rounded-full border border-vscode-panelBorder bg-vscode-inputBg px-2 py-0.5 text-[11px] text-vscode-descriptionFg hover:underline"
              title={`View ${mention.label} in Explorer`}
            >
              {`📍 View in Explorer: ${mention.label}`}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
