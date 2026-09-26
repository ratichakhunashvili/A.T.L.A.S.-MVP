/**
 * Server-side AI plumbing.
 *
 * This module is the only place in the repository that touches a provider
 * credential. It runs as a serverless function, so the key is read from the
 * environment at request time and never crosses into a client bundle — which
 * is why the browser's `AIProvider` talks to `/api/ai/*` instead of talking to
 * a model directly.
 *
 * Two providers are supported out of the box and both speak the same shape to
 * the rest of the application. Adding a third means adding a branch to
 * `callModel` and nothing else.
 *
 * Environment:
 *   AI_PROVIDER        "anthropic" | "openai" | unset (disables AI entirely)
 *   ANTHROPIC_API_KEY  required when AI_PROVIDER=anthropic
 *   OPENAI_API_KEY     required when AI_PROVIDER=openai
 *   AI_MODEL           optional model id override
 *   AI_BASE_URL        optional, for an OpenAI-compatible or local endpoint
 */

export type ProviderName = "anthropic" | "openai";

export interface ProviderConfig {
  provider: ProviderName;
  apiKey: string;
  model: string;
  baseUrl: string;
}

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o-mini",
};

const DEFAULT_BASE_URLS: Record<ProviderName, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
};

/**
 * Resolves configuration, or null when AI is switched off.
 *
 * Returning null rather than throwing is deliberate: an unconfigured
 * deployment is a supported, fully working state, not an error condition.
 */
export function readConfig(): ProviderConfig | null {
  const provider = process.env.AI_PROVIDER as ProviderName | undefined;
  if (provider !== "anthropic" && provider !== "openai") return null;

  const apiKey =
    provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  return {
    provider,
    apiKey,
    model: process.env.AI_MODEL || DEFAULT_MODELS[provider],
    baseUrl: process.env.AI_BASE_URL || DEFAULT_BASE_URLS[provider],
  };
}

/** How long the function itself will wait before giving up on the provider. */
const UPSTREAM_TIMEOUT_MS = 12_000;

/**
 * Sends one system + user exchange and returns the raw text.
 *
 * Both branches ask for a JSON object and nothing else; parsing and validation
 * happen in the caller, because a provider that ignores the instruction should
 * fail the same way whichever provider it is.
 */
export async function callModel(
  config: ProviderConfig,
  system: string,
  user: string,
  maxTokens = 1200,
): Promise<string> {
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);

  if (config.provider === "anthropic") {
    const response = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`anthropic ${response.status}: ${await safeText(response)}`);
    }

    const body = (await response.json()) as { content?: { type: string; text?: string }[] };
    return body.content?.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`openai ${response.status}: ${await safeText(response)}`);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return body.choices?.[0]?.message?.content ?? "";
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "<unreadable>";
  }
}

/**
 * Pulls a JSON object out of a model response.
 *
 * Models wrap JSON in prose or fences more often than they should. Rather than
 * failing the whole plan over a stray ```json, this finds the outermost object
 * and parses that — and still throws if there genuinely isn't one.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to extraction.
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model response");

  return JSON.parse(trimmed.slice(start, end + 1));
}

/* ------------------------------------------------------------------------ */
/* Request helpers                                                           */
/* ------------------------------------------------------------------------ */

export interface ApiRequest {
  method?: string;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

/** Rejects anything that is not the expected verb. */
export function requireMethod(
  request: ApiRequest,
  response: ApiResponse,
  method: string,
): boolean {
  if ((request.method ?? "GET").toUpperCase() === method) return true;
  response.status(405).json({ error: "method_not_allowed" });
  return false;
}

/**
 * Bodies arrive parsed on Vercel and as a string elsewhere. Accepting both
 * keeps these functions runnable under `vercel dev`, a plain Node server, or a
 * test harness without a shim.
 */
export function readBody<T>(request: ApiRequest): T {
  const { body } = request;
  if (typeof body === "string") return JSON.parse(body) as T;
  return (body ?? {}) as T;
}
