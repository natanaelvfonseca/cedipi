export const UNAUTHORIZED_EVENT = "cedipi:unauthorized";

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return response;
}
