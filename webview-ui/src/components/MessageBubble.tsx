import { useCallback } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
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

const markdownComponents: Components = {
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
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="rounded bg-vscode-inlineCodeBg px-1 py-0.5 text-xs"
          {...props}
        >
          {children}
        </code>
      );
    }

    return <CodeBlock className={className}>{children}</CodeBlock>;
  }
};

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
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.text}
        </ReactMarkdown>
      )}
    </article>
  );
}
