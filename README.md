# postchat README

This is the README for your extension "postchat". After writing up a brief description, we recommend including the following sections.

## Features

⏺ Postchat is a VS Code extension that brings an AI-powered API client directly into your editor. It lets you:                                                               
                                                                                                                                                                             
  - Load Postman collections or OpenAPI/Swagger specs
  - Chat with an AI assistant about your API — ask questions, find endpoints, understand authentication, and get usage examples                                              
  - Explore endpoints in a structured browser with search and filtering                                                                                                      
  - Send requests from a dedicated request tab with a full editor for headers, body, and parameters — and view syntax-highlighted responses                                  
  - Combine AI + execution — ask the AI about an endpoint and jump straight into running it, or analyze a response with AI from the same panel                               

  It bridges the gap between API documentation and live testing, all without leaving VS Code.

## Explorer

The Explorer tab gives you an API-first view of your loaded collection/spec and keeps Chat actions connected to endpoint context.

### How to use the Explorer tab

1. Click **Load Collection** and choose a supported file.
2. Open the **Explorer** tab.
3. Select an endpoint/operation.
4. Use **Run** to execute requests and **Ask AI** to send contextual questions to chat.
5. Use **View in Explorer** chips from assistant messages to jump back to endpoints.

### Supported file types

- Postman Collection JSON
- OpenAPI 3.0 YAML/JSON
- Swagger 2.0 YAML/JSON

### Chat bridge behavior

- **Ask AI** from Explorer generates endpoint-aware prompts in chat.
- **Run** executes the selected endpoint and returns a structured response viewer.
- **View in Explorer** links in chat jump to:
  - Postman endpoints in the custom sidebar
  - OpenAPI/Swagger operations in Stoplight (hash navigation)

### Explorer keyboard shortcuts

- `Cmd/Ctrl+F`: Focus endpoint search (Postman explorer)
- `Escape`: Clear search or deselect endpoint
- `Cmd/Ctrl+Enter`: Run selected endpoint (when detail panel is focused)
- `Cmd/Ctrl+Shift+A`: Ask AI about selected endpoint

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
