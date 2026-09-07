import { timingSafeEqual } from "node:crypto";

const headerName = "x-cedipi-internal-secret";

function sameSecret(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string" || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function createRequireInternalSecret(secret = process.env.N8N_INTERNAL_API_SECRET) {
  return function requireInternalSecret(request, response, next) {
    const received = request.get(headerName);
    if (!received) {
      response.status(401).json({ ok: false, error: "internal_auth_required" });
      return;
    }
    if (!secret) {
      response.status(503).json({ ok: false, error: "internal_api_unavailable" });
      return;
    }
    if (!sameSecret(received, secret)) {
      response.status(403).json({ ok: false, error: "internal_auth_invalid" });
      return;
    }
    next();
  };
}
