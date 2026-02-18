/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        vscode: {
          editorBg: "var(--vscode-editor-background)",
          editorFg: "var(--vscode-editor-foreground)",
          panelBorder: "var(--vscode-panel-border)",
          buttonBg: "var(--vscode-button-background)",
          buttonFg: "var(--vscode-button-foreground)",
          buttonHover: "var(--vscode-button-hoverBackground)",
          buttonSecondaryBg: "var(--vscode-button-secondaryBackground)",
          buttonSecondaryFg: "var(--vscode-button-secondaryForeground)",
          buttonSecondaryHover: "var(--vscode-button-secondaryHoverBackground)",
          inputBg: "var(--vscode-input-background)",
          inputFg: "var(--vscode-input-foreground)",
          inputBorder: "var(--vscode-input-border)",
          placeholder: "var(--vscode-input-placeholderForeground)",
          badgeBg: "var(--vscode-badge-background)",
          badgeFg: "var(--vscode-badge-foreground)",
          linkFg: "var(--vscode-textLink-foreground)",
          focusBorder: "var(--vscode-focusBorder)",
          listHover: "var(--vscode-list-hoverBackground)",
          inlineCodeBg: "var(--vscode-textCodeBlock-background)",
          card: "var(--vscode-sideBar-background)",
          muted: "var(--vscode-descriptionForeground)",
          errorBg: "var(--vscode-inputValidation-errorBackground)",
          errorFg: "var(--vscode-inputValidation-errorForeground)",
          errorBorder: "var(--vscode-inputValidation-errorBorder)"
        }
      }
    }
  },
  plugins: []
};
