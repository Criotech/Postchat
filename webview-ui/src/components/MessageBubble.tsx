import { useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Message } from "../types";

type MessageBubbleProps = {
  message: Message;
};

function CodeBlock({
  className,
  children
}: {
  className?: string;
  children?: React.ReactNode;
}): JSX.Element {
  const match = /language-(\w+)/.exec(className ?? "");
  const language = match?.[1] ?? "text";
  const rawCode = String(children ?? "").replace(/\n$/, "");

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(rawCode);
  }, [rawCode]);

  return (
    <div className="relative my-3 overflow-hidden rounded-md border border-vscode-panelBorder">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 z-10 rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
      >
        Copy
      </button>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{ margin: 0, paddingTop: "2.25rem", fontSize: "0.8rem" }}
      >
        {rawCode}
      </SyntaxHighlighter>
    </div>
  );
}

export function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === "user";

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
        <div className="prose prose-sm max-w-none prose-headings:text-vscode-editorFg prose-p:text-vscode-editorFg prose-code:text-vscode-editorFg prose-strong:text-vscode-editorFg prose-a:text-vscode-linkFg prose-li:text-vscode-editorFg">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ inline, className, children }) {
                if (inline) {
                  return (
                    <code className="rounded bg-vscode-inlineCodeBg px-1 py-0.5 text-xs">
                      {children}
                    </code>
                  );
                }

                return <CodeBlock className={className}>{children}</CodeBlock>;
              }
            }}
          >
            {message.text}
          </ReactMarkdown>
        </div>
      )}
    </article>
  );
}
