/**
 * Accounts.
 *
 * `AuthService` is the seam. The product talks to this interface and nothing
 * else, so connecting Supabase, Firebase or a custom API later is one adapter
 * file and a one-line swap at the bottom — the same arrangement the model
 * registry uses.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The implementation below is a BROWSER-LOCAL STAND-IN, not real authentication.
 * Accounts live in this browser's `localStorage` and nowhere else. Passwords
 * are salted and hashed rather than stored in the clear, but that protects
 * almost nothing when the hash sits next to the data on the same device: there
 * is no server, no rate limiting, and no way to revoke a session.
 *
 * It exists so the sign-up and sign-in experience can be designed, used and
 * tested end to end. Swap in a real provider before anyone's actual password
 * is typed into it.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  createdAt: string;
}

export interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export type AuthErrorCode =
  | "email-taken"
  | "invalid-credentials"
  | "weak-password"
  | "unsupported"
  | "unknown";

export class AuthError extends Error {
  code: AuthErrorCode;
  /** Which form field the message belongs under, when it belongs to one. */
  field?: "fullName" | "email" | "password" | "confirm" | "phone";

  constructor(code: AuthErrorCode, message: string, field?: AuthError["field"]) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.field = field;
  }
}

export interface AuthService {
  /** The signed-in user, restored from any persisted session. */
  current(): Promise<AuthUser | null>;
  signUp(input: SignUpInput): Promise<AuthUser>;
  signIn(input: SignInInput): Promise<AuthUser>;
  signOut(): Promise<void>;
}

/* ------------------------------------------------------------------------ */
/* Validation — shared by the form and the service                           */
/* ------------------------------------------------------------------------ */

/** Deliberately permissive: the only authority on an address is sending to it. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const PASSWORD_HINT = "At least 8 characters, with a letter and a number.";

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter your email address.";
  if (!EMAIL.test(email)) return "That does not look like an email address.";
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return "Choose a password.";
  if (value.length < 8) return "Use at least 8 characters.";
  if (!/[a-z]/i.test(value) || !/\d/.test(value)) return "Include a letter and a number.";
  return null;
}

export function validateFullName(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter your name.";
  if (name.length < 2) return "That name looks too short.";
  return null;
}

export function validatePhone(value: string): string | null {
  const phone = value.trim();
  if (!phone) return null; // optional
  if (!/^[+()\d\s-]{6,20}$/.test(phone)) return "That does not look like a phone number.";
  return null;
}

/* ------------------------------------------------------------------------ */
/* Browser-local implementation                                              */
/* ------------------------------------------------------------------------ */

const USERS_KEY = "hospitality-map.auth.users.v1";
const SESSION_KEY = "hospitality-map.auth.session.v1";

interface StoredUser extends AuthUser {
  salt: string;
  hash: string;
}

function readUsers(): StoredUser[] {
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredUser[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]): void {
  try {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch {
    /* private mode — the account lasts as long as the tab */
  }
}

function toPublic({ salt, hash, ...user }: StoredUser): AuthUser {
  void salt;
  void hash;
  return user;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  if (!crypto?.subtle) {
    throw new AuthError(
      "unsupported",
      "This browser cannot create an account securely here. Try a normal window over https.",
    );
  }
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

class LocalAuthService implements AuthService {
  async current(): Promise<AuthUser | null> {
    try {
      const id = window.localStorage.getItem(SESSION_KEY);
      if (!id) return null;
      const user = readUsers().find((candidate) => candidate.id === id);
      return user ? toPublic(user) : null;
    } catch {
      return null;
    }
  }

  async signUp({ fullName, email, password, phone }: SignUpInput): Promise<AuthUser> {
    const address = email.trim().toLowerCase();
    const weak = validatePassword(password);
    if (weak) throw new AuthError("weak-password", weak, "password");

    const users = readUsers();
    if (users.some((user) => user.email === address)) {
      throw new AuthError(
        "email-taken",
        "An account already uses that email. Sign in instead.",
        "email",
      );
    }

    const salt = randomHex(16);
    const record: StoredUser = {
      id: randomHex(8),
      fullName: fullName.trim(),
      email: address,
      phone: phone?.trim() || undefined,
      createdAt: new Date().toISOString(),
      salt,
      hash: await hashPassword(password, salt),
    };

    writeUsers([...users, record]);
    this.persistSession(record.id);
    return toPublic(record);
  }

  async signIn({ email, password }: SignInInput): Promise<AuthUser> {
    const address = email.trim().toLowerCase();
    const user = readUsers().find((candidate) => candidate.email === address);

    // Hash even when the address is unknown, so a wrong email and a wrong
    // password take the same time to fail.
    const salt = user?.salt ?? randomHex(16);
    const attempt = await hashPassword(password, salt);

    if (!user || attempt !== user.hash) {
      throw new AuthError("invalid-credentials", "That email and password do not match.", "password");
    }

    this.persistSession(user.id);
    return toPublic(user);
  }

  async signOut(): Promise<void> {
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  private persistSession(id: string): void {
    try {
      window.localStorage.setItem(SESSION_KEY, id);
    } catch {
      /* session lasts for this page only */
    }
  }
}

/** The service the app uses. Swap this line to change providers. */
export const authService: AuthService = new LocalAuthService();
