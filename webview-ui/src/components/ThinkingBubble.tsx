export function ThinkingBubble(): JSX.Element {
  return (
    <div className="mr-auto max-w-[85%] rounded-lg border border-vscode-panelBorder bg-vscode-card px-3 py-2 text-sm text-vscode-muted">
      <span className="inline-flex items-center gap-1">
        Thinking
        <span className="inline-flex">
          <span className="mx-[1px] h-1.5 w-1.5 animate-bounce rounded-full bg-vscode-editorFg [animation-delay:-0.2s]" />
          <span className="mx-[1px] h-1.5 w-1.5 animate-bounce rounded-full bg-vscode-editorFg [animation-delay:-0.1s]" />
          <span className="mx-[1px] h-1.5 w-1.5 animate-bounce rounded-full bg-vscode-editorFg" />
        </span>
      </span>
    </div>
  );
}
