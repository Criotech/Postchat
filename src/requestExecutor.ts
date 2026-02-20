export type ExecutableRequest = {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export type ExecutionResult = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
};

const REQUEST_TIMEOUT_MS = 10_000;

export async function executeRequest(req: ExecutableRequest): Promise<ExecutionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const start = Date.now();

  try {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body ?? undefined,
      signal: controller.signal
    });

    const body = await response.text();
    const durationMs = Date.now() - start;

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
      durationMs
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Network error: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}
