export const SESSION_COOKIE = 'lookout_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('DASHBOARD_SESSION_SECRET must be set and at least 32 chars');
  }
  return secret;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = hexToBytes(a);
  const bb = hexToBytes(b);
  if (ab.length !== bb.length || ab.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  // Always run the loop on max length to avoid early-exit timing leak.
  const len = Math.max(ae.length, be.length);
  let diff = ae.length ^ be.length;
  for (let i = 0; i < len; i++) {
    const av = i < ae.length ? ae[i] : 0;
    const bv = i < be.length ? be[i] : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

export async function comparePassword(submitted: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  return timingSafeEqualString(submitted, expected);
}

export async function signSession(expiresAtMs: number): Promise<string> {
  const payload = String(expiresAtMs);
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function verifySession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const idx = cookieValue.indexOf('.');
  if (idx < 0) return false;
  const payload = cookieValue.slice(0, idx);
  const sig = cookieValue.slice(idx + 1);
  const expected = await hmac(payload);
  if (!timingSafeEqualHex(sig, expected)) return false;
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() < expiresAt;
}

export async function newSessionCookieValue(): Promise<string> {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  return signSession(expiresAt);
}
