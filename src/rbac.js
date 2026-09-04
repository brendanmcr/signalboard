// Role hierarchy: viewer < poster < admin.
const RANK = { viewer: 1, poster: 2, admin: 3 };

export const ROLES = Object.keys(RANK);

export function atLeast(role, required) {
  return (RANK[role] ?? 0) >= RANK[required];
}

export function bearerToken(headerValue) {
  if (typeof headerValue !== "string") return null;
  return headerValue.startsWith("Bearer ") ? headerValue.slice(7) : null;
}

// Express middleware. Attaches req.actor = { role, tokenPrefix }.
// Full tokens are never attached or logged.
export function requireRole(storage, required) {
  return async (req, res, next) => {
    try {
      const token = bearerToken(req.headers.authorization);
      const role = token ? await storage.getRole(token) : null;
      if (!role) return res.status(401).json({ error: "missing or unknown token" });
      if (!atLeast(role, required)) {
        return res.status(403).json({ error: `requires role ${required}` });
      }
      req.actor = { role, tokenPrefix: token.slice(0, 8) };
      next();
    } catch (err) {
      next(err);
    }
  };
}
