/**
 * Who is signed in.
 *
 * Guest access is the default and stays fully functional: nothing in the
 * product is gated behind an account. Signing in adds identity to the profile
 * that already exists, it does not unlock the map.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  authService,
  type AuthUser,
  type SignInInput,
  type SignUpInput,
} from "./authService";

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the persisted session has been checked. */
  loading: boolean;
  signUp: (input: SignUpInput) => Promise<AuthUser>;
  signIn: (input: SignInInput) => Promise<AuthUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void authService
      .current()
      .then((restored) => {
        if (!cancelled) setUser(restored);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const created = await authService.signUp(input);
    setUser(created);
    return created;
  }, []);

  const signIn = useCallback(async (input: SignInInput) => {
    const signedIn = await authService.signIn(input);
    setUser(signedIn);
    return signedIn;
  }, []);

  const signOut = useCallback(async () => {
    await authService.signOut();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signUp, signIn, signOut }),
    [user, loading, signUp, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
