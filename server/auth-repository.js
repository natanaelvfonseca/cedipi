import { getDatabasePool } from "./database.js";

export class AuthRepositoryError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "AuthRepositoryError";
    this.code = code;
    this.status = status;
  }
}

const publicUserColumns = `
  id, name, email, role, active, must_change_password, last_login_at, created_at, updated_at
`;

export function mapPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    mustChangePassword: row.must_change_password,
    lastLoginAt: row.last_login_at?.toISOString?.() ?? row.last_login_at ?? null,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

async function audit(client, event, { actorUserId = null, subjectUserId = null, ipAddress = null, userAgent = null, details = {} } = {}) {
  await client.query(
    `INSERT INTO auth_audit_log (event, actor_user_id, subject_user_id, ip_address, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb);`,
    [event, actorUserId, subjectUserId, ipAddress, userAgent, JSON.stringify(details)],
  );
}

export function createAuthRepository(pool = getDatabasePool()) {
  return {
    async hasAdmin() {
      const result = await pool.query("SELECT EXISTS (SELECT 1 FROM users WHERE role = 'admin') AS present;");
      return result.rows[0].present === true;
    },

    async bootstrapAdmin({ name, email, passwordHash }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN;");
        await client.query("SELECT pg_advisory_xact_lock($1);", [20260907]);
        const existing = await client.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1;");
        if (existing.rows[0]) {
          await client.query("COMMIT;");
          return { created: false };
        }
        const result = await client.query(
          `INSERT INTO users (name, email, password_hash, role, must_change_password)
           VALUES ($1, $2, $3, 'admin', TRUE) RETURNING ${publicUserColumns};`,
          [name, email, passwordHash],
        );
        await audit(client, "user_created", { subjectUserId: result.rows[0].id, details: { bootstrap: true } });
        await client.query("COMMIT;");
        return { created: true, user: mapPublicUser(result.rows[0]) };
      } catch (error) {
        await client.query("ROLLBACK;").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async findUserForLogin(email) {
      const result = await pool.query(
        `SELECT ${publicUserColumns}, password_hash FROM users WHERE email = $1 LIMIT 1;`,
        [email],
      );
      return result.rows[0] ?? null;
    },

    async recordLogin({ userId, tokenHash, expiresAt, userAgent, ipAddress }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN;");
        const userResult = await client.query(
          `UPDATE users SET last_login_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND active = TRUE RETURNING ${publicUserColumns};`,
          [userId],
        );
        if (!userResult.rows[0]) throw new AuthRepositoryError("invalid_credentials", 401);
        await client.query(
          `INSERT INTO user_sessions (user_id, token_hash, expires_at, user_agent, ip_address)
           VALUES ($1, $2, $3, $4, $5);`,
          [userId, tokenHash, expiresAt, userAgent, ipAddress],
        );
        await audit(client, "login_success", { actorUserId: userId, subjectUserId: userId, ipAddress, userAgent });
        await client.query("COMMIT;");
        return mapPublicUser(userResult.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK;").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async recordLoginFailure({ userId = null, ipAddress, userAgent }) {
      await audit(pool, "login_failure", { subjectUserId: userId, ipAddress, userAgent });
    },

    async findSession(tokenHash) {
      const result = await pool.query(
        `SELECT s.id AS session_id, s.token_hash, s.expires_at, s.last_seen_at, ${publicUserColumns.split(", ").map((column) => `u.${column.trim()}`).join(", ")}
         FROM user_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 LIMIT 1;`,
        [tokenHash],
      );
      return result.rows[0] ?? null;
    },

    async touchSession(sessionId) {
      await pool.query("UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1;", [sessionId]);
    },

    async deleteSession(tokenHash, context = {}) {
      const result = await pool.query("DELETE FROM user_sessions WHERE token_hash = $1 RETURNING user_id;", [tokenHash]);
      if (result.rows[0]) await audit(pool, "logout", { ...context, actorUserId: result.rows[0].user_id });
    },

    async changePassword({ userId, currentTokenHash, passwordHash, context }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN;");
        const result = await client.query(
          `UPDATE users SET password_hash = $2, must_change_password = FALSE, updated_at = NOW()
           WHERE id = $1 RETURNING ${publicUserColumns};`,
          [userId, passwordHash],
        );
        await client.query("DELETE FROM user_sessions WHERE user_id = $1 AND token_hash <> $2;", [userId, currentTokenHash]);
        await audit(client, "password_changed", { ...context, actorUserId: userId, subjectUserId: userId });
        await client.query("COMMIT;");
        return mapPublicUser(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK;").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async listUsers() {
      const result = await pool.query(`SELECT ${publicUserColumns} FROM users ORDER BY name, email;`);
      return result.rows.map(mapPublicUser);
    },

    async createUser({ name, email, passwordHash, role, actorUserId, context }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN;");
        const result = await client.query(
          `INSERT INTO users (name, email, password_hash, role, active, must_change_password)
           VALUES ($1, $2, $3, $4, TRUE, TRUE) RETURNING ${publicUserColumns};`,
          [name, email, passwordHash, role],
        );
        await audit(client, "user_created", { ...context, actorUserId, subjectUserId: result.rows[0].id });
        await client.query("COMMIT;");
        return mapPublicUser(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK;").catch(() => {});
        if (error?.code === "23505") throw new AuthRepositoryError("email_already_exists", 409);
        throw error;
      } finally {
        client.release();
      }
    },

    async updateUser({ userId, changes, actorUserId, context }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN;");
        const targetResult = await client.query("SELECT id, role, active FROM users WHERE id = $1 FOR UPDATE;", [userId]);
        const target = targetResult.rows[0];
        if (!target) throw new AuthRepositoryError("user_not_found", 404);
        const nextActive = changes.active ?? target.active;
        const nextRole = changes.role ?? target.role;
        if (userId === actorUserId && !nextActive) throw new AuthRepositoryError("cannot_disable_self", 409);
        if (target.active && target.role === "admin" && (!nextActive || nextRole !== "admin")) {
          const admins = await client.query("SELECT id FROM users WHERE role = 'admin' AND active = TRUE FOR UPDATE;");
          if (admins.rows.length <= 1) throw new AuthRepositoryError("last_active_admin", 409);
        }
        const result = await client.query(
          `UPDATE users SET
             name = COALESCE($2, name), email = COALESCE($3, email),
             role = COALESCE($4, role), active = COALESCE($5, active), updated_at = NOW()
           WHERE id = $1 RETURNING ${publicUserColumns};`,
          [userId, changes.name ?? null, changes.email ?? null, changes.role ?? null, changes.active ?? null],
        );
        if (!nextActive) await client.query("DELETE FROM user_sessions WHERE user_id = $1;", [userId]);
        await audit(client, nextActive ? "user_updated" : "user_disabled", { ...context, actorUserId, subjectUserId: userId });
        await client.query("COMMIT;");
        return mapPublicUser(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK;").catch(() => {});
        if (error?.code === "23505") throw new AuthRepositoryError("email_already_exists", 409);
        throw error;
      } finally {
        client.release();
      }
    },

    async resetPassword({ userId, passwordHash, actorUserId, context }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN;");
        const result = await client.query(
          `UPDATE users SET password_hash = $2, must_change_password = TRUE, updated_at = NOW()
           WHERE id = $1 RETURNING ${publicUserColumns};`,
          [userId, passwordHash],
        );
        if (!result.rows[0]) throw new AuthRepositoryError("user_not_found", 404);
        await client.query("DELETE FROM user_sessions WHERE user_id = $1;", [userId]);
        await audit(client, "password_reset", { ...context, actorUserId, subjectUserId: userId });
        await client.query("COMMIT;");
        return mapPublicUser(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK;").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
