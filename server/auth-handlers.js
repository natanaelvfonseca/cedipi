import { AuthRepositoryError } from "./auth-repository.js";
import { AuthServiceError } from "./auth-service.js";
import { requestContext, SESSION_COOKIE_NAME } from "./auth-middleware.js";

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" };
}

function sendKnownError(error, response) {
  if (error instanceof AuthServiceError || error instanceof AuthRepositoryError) {
    response.status(error.status).json({ ok: false, error: error.code });
    return true;
  }
  return false;
}

export function createLoginHandler(authService, limiter) {
  return async (request, response, next) => {
    const key = request.ip || "unknown";
    if (limiter.isBlocked(key)) return response.status(429).json({ ok: false, error: "too_many_attempts" });
    try {
      const result = await authService.login(request.body ?? {}, requestContext(request));
      limiter.clear(key);
      response.cookie(SESSION_COOKIE_NAME, result.token, {
        ...cookieOptions(), maxAge: Math.max(0, result.expiresAt.getTime() - Date.now()),
      });
      response.json({ ok: true, user: result.user });
    } catch (error) {
      if (error instanceof AuthServiceError && error.code === "invalid_credentials") limiter.recordFailure(key);
      if (!sendKnownError(error, response)) next(error);
    }
  };
}

export function createMeHandler() {
  return (request, response) => response.json({ ok: true, user: request.auth.user });
}

export function createLogoutHandler(authService) {
  return async (request, response, next) => {
    try {
      await authService.logout(request.auth.tokenHash, requestContext(request));
      response.clearCookie(SESSION_COOKIE_NAME, cookieOptions());
      response.json({ ok: true });
    } catch (error) { next(error); }
  };
}

export function createChangePasswordHandler(authService) {
  return async (request, response, next) => {
    try {
      const user = await authService.changePassword({
        user: request.auth.user,
        tokenHash: request.auth.tokenHash,
        currentPassword: request.body?.currentPassword,
        newPassword: request.body?.newPassword,
      }, requestContext(request));
      response.json({ ok: true, user });
    } catch (error) {
      if (!sendKnownError(error, response)) next(error);
    }
  };
}

export function createUsersHandlers(authService) {
  return {
    list: async (_request, response, next) => {
      try { response.json({ ok: true, users: await authService.listUsers() }); } catch (error) { next(error); }
    },
    create: async (request, response, next) => {
      try {
        const user = await authService.createUser(request.body, request.auth.user, requestContext(request));
        response.status(201).json({ ok: true, user });
      } catch (error) { if (!sendKnownError(error, response)) next(error); }
    },
    update: async (request, response, next) => {
      try {
        const user = await authService.updateUser(request.params.userId, request.body, request.auth.user, requestContext(request));
        response.json({ ok: true, user });
      } catch (error) { if (!sendKnownError(error, response)) next(error); }
    },
    resetPassword: async (request, response, next) => {
      try {
        const user = await authService.resetPassword(request.params.userId, request.body, request.auth.user, requestContext(request));
        response.json({ ok: true, user });
      } catch (error) { if (!sendKnownError(error, response)) next(error); }
    },
  };
}
