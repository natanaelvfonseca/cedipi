import { apiFetch } from "./api-fetch.ts";

export class AiControlApiError extends Error {
  constructor() {
    super("ai_control_request_failed");
    this.name = "AiControlApiError";
  }
}

async function requestAiControl(
  options: RequestInit,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchImpl("/api/ai-control", options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AiControlApiError();
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiControlApiError();
  }

  if (
    !response.ok
    || !payload
    || typeof payload !== "object"
    || !("ok" in payload)
    || payload.ok !== true
    || !("globalEnabled" in payload)
    || typeof payload.globalEnabled !== "boolean"
  ) {
    throw new AiControlApiError();
  }

  return payload.globalEnabled;
}

export function getAiControl(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = apiFetch,
) {
  return requestAiControl({ method: "GET", signal }, fetchImpl);
}

export function patchAiControl(
  enabled: boolean,
  fetchImpl: typeof fetch = apiFetch,
) {
  return requestAiControl({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  }, fetchImpl);
}
