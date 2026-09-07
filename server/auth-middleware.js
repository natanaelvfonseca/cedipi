import { AuthServiceError } from "./auth-service.js";

export const SESSION_COOKIE_NAME = "cedipi_session";

export function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [];
    const key = part.slice(0, separator).trim();
    try { return [[key, decodeURIComponent(part.slice(separator + 1).trim())]]; } catch { return []; }
  }));
}

function unauthorized(response) {
  response.status(401).json({ ok: false, error: "unauthorized" });
}

export function createRequireAuth(authService) {
  return async (request, response, next) => {
    try {
      const token = parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME];
      request.auth = await authService.authenticate(token);
      next();
    } catch (error) {
      if (error instanceof AuthServiceError && error.status === 401) return unauthorized(response);
      next(error);
    }
  };
}

export function requirePasswordChanged(request, response, next) {
  if (request.auth.user.mustChangePassword) {
    response.status(403).json({ ok: false, error: "password_change_required" });
    return;
  }
  next();
}

export function requireAdmin(request, response, next) {
  if (request.auth.user.role !== "admin") {
    response.status(403).json({ ok: false, error: "admin_required" });
    return;
  }
  next();
}

export function verifySameOrigin(request, response, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return next();
  const origin = request.get("origin");
  if (!origin) return next();
  const expected = `${request.protocol}://${request.get("host")}`;
  if (origin !== expected) {
    response.status(403).json({ ok: false, error: "invalid_origin" });
    return;
  }
  next();
}

export function requestContext(request) {
  return {
    ipAddress: request.ip || null,
    userAgent: request.get("user-agent")?.slice(0, 500) || null,
  };
}
