import { createHash, randomBytes } from "node:crypto";
import { createAuthRepository, AuthRepositoryError, mapPublicUser } from "./auth-repository.js";
import { hashPassword, validatePassword, verifyPassword } from "./auth-password.js";

export class AuthServiceError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "AuthServiceError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function requiredName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 160) throw new AuthServiceError("invalid_name");
  return name;
}

function validEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthServiceError("invalid_email");
  }
  return email;
}

function validRole(value) {
  if (value !== "admin" && value !== "attendant") throw new AuthServiceError("invalid_role");
  return value;
}

function validId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AuthServiceError("invalid_user_id");
  }
  return value;
}

export function sessionTtlHours(value = process.env.AUTH_SESSION_TTL_HOURS) {
  if (value === undefined || value === "") return 12;
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error("AUTH_SESSION_TTL_HOURS inválido.");
  return hours;
}

export function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

let dummyPasswordHash;

export function createAuthService(repository = createAuthRepository(), options = {}) {
  const now = options.now ?? (() => new Date());
  const ttlHours = options.ttlHours ?? sessionTtlHours();

  return {
    async bootstrapInitialAdmin(env = process.env) {
      if (await repository.hasAdmin()) return { created: false };
      const name = env.CEDIPI_INITIAL_ADMIN_NAME;
      const email = env.CEDIPI_INITIAL_ADMIN_EMAIL;
      const password = env.CEDIPI_INITIAL_ADMIN_PASSWORD;
      if (!name || !email || !password) throw new Error("Configuração do administrador inicial incompleta.");
      if (!validatePassword(password)) throw new Error("Senha do administrador inicial inválida.");
      return repository.bootstrapAdmin({
        name: requiredName(name),
        email: validEmail(email),
        passwordHash: await hashPassword(password),
      });
    },

    async login({ email: rawEmail, password }, context = {}) {
      const email = normalizeEmail(rawEmail);
      const user = email ? await repository.findUserForLogin(email) : null;
      dummyPasswordHash ??= await hashPassword(randomBytes(20).toString("base64url"));
      const passwordMatches = typeof password === "string" && await verifyPassword(password, user?.password_hash ?? dummyPasswordHash);
      if (!user || !user.active || !passwordMatches) {
        await repository.recordLoginFailure({ userId: user?.id ?? null, ...context });
        throw new AuthServiceError("invalid_credentials", 401);
      }
      const token = randomBytes(32).toString("base64url");
      const tokenHash = hashSessionToken(token);
      const expiresAt = new Date(now().getTime() + ttlHours * 60 * 60 * 1000);
      const publicUser = await repository.recordLogin({ userId: user.id, tokenHash, expiresAt, ...context });
      return { token, tokenHash, expiresAt, user: publicUser };
    },

    async authenticate(token) {
      if (!token) throw new AuthServiceError("unauthorized", 401);
      const tokenHash = hashSessionToken(token);
      const session = await repository.findSession(tokenHash);
      if (!session || !session.active || new Date(session.expires_at).getTime() <= now().getTime()) {
        if (session) await repository.deleteSession(tokenHash);
        throw new AuthServiceError("unauthorized", 401);
      }
      if (!session.last_seen_at || now().getTime() - new Date(session.last_seen_at).getTime() > 5 * 60 * 1000) {
        await repository.touchSession(session.session_id);
      }
      return { tokenHash, user: mapPublicUser(session) };
    },

    async logout(tokenHash, context = {}) {
      if (tokenHash) await repository.deleteSession(tokenHash, context);
    },

    async changePassword({ user, tokenHash, currentPassword, newPassword }, context = {}) {
      if (!validatePassword(newPassword)) throw new AuthServiceError("invalid_password");
      const record = await repository.findUserForLogin(user.email);
      if (!record || !await verifyPassword(currentPassword, record.password_hash)) {
        throw new AuthServiceError("invalid_current_password", 400);
      }
      if (await verifyPassword(newPassword, record.password_hash)) throw new AuthServiceError("password_unchanged");
      return repository.changePassword({
        userId: user.id,
        currentTokenHash: tokenHash,
        passwordHash: await hashPassword(newPassword),
        context,
      });
    },

    listUsers() {
      return repository.listUsers();
    },

    async createUser(input, actor, context = {}) {
      if (!validatePassword(input?.temporaryPassword)) throw new AuthServiceError("invalid_password");
      return repository.createUser({
        name: requiredName(input?.name),
        email: validEmail(input?.email),
        passwordHash: await hashPassword(input.temporaryPassword),
        role: validRole(input?.role),
        actorUserId: actor.id,
        context,
      });
    },

    updateUser(userId, input, actor, context = {}) {
      const changes = {};
      if (Object.hasOwn(input ?? {}, "name")) changes.name = requiredName(input.name);
      if (Object.hasOwn(input ?? {}, "email")) changes.email = validEmail(input.email);
      if (Object.hasOwn(input ?? {}, "role")) changes.role = validRole(input.role);
      if (Object.hasOwn(input ?? {}, "active")) {
        if (typeof input.active !== "boolean") throw new AuthServiceError("invalid_active");
        changes.active = input.active;
      }
      if (Object.keys(changes).length === 0) throw new AuthServiceError("empty_update");
      return repository.updateUser({ userId: validId(userId), changes, actorUserId: actor.id, context });
    },

    async resetPassword(userId, input, actor, context = {}) {
      if (!validatePassword(input?.temporaryPassword)) throw new AuthServiceError("invalid_password");
      return repository.resetPassword({
        userId: validId(userId),
        passwordHash: await hashPassword(input.temporaryPassword),
        actorUserId: actor.id,
        context,
      });
    },
  };
}

export { AuthRepositoryError };
