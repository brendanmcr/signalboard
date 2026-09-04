import { memoryStorage } from "./memory.js";
import { pgStorage } from "./pg.js";

export function storageFromEnv(env = process.env) {
  if (env.DATABASE_URL) return pgStorage(env.DATABASE_URL);
  return memoryStorage();
}
