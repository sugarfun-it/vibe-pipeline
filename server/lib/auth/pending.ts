import { randomBytes } from "node:crypto";

type Pending = {
  secret: string;
  expiresAt: number;
};

const SETUP_TTL_MS = 5 * 60 * 1000;
const pending = new Map<string, Pending>();

export function createSetupToken(secret: string): string {
  const token = randomBytes(16).toString("hex");
  pending.set(token, { secret, expiresAt: Date.now() + SETUP_TTL_MS });
  return token;
}

export function consumeSetupToken(token: string): string | null {
  const entry = pending.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pending.delete(token);
    return null;
  }
  pending.delete(token);
  return entry.secret;
}

