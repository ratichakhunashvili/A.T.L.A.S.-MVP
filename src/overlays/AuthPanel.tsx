/**
 * Sign up and sign in, as a sheet over the map.
 *
 * Same overlay model as everything else — no route, no page, the map still
 * visible behind it. Guest access is never taken away: "Continue as guest"
 * simply closes the sheet, because nothing in the product is gated behind an
 * account. An account is for keeping what you collect, not for entry.
 *
 * Validation is inline and per field. Nothing here ever calls `alert()`.
 */

import { Eye, EyeOff, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BottomSheet, SheetHeader } from "../ui/sheets/Sheets";
import { useAuth } from "../auth/AuthProvider";
import { useOverlay } from "../state/overlay";
import {
  AuthError,
  PASSWORD_HINT,
  validateEmail,
  validateFullName,
  validatePassword,
  validatePhone,
} from "../auth/authService";

type Mode = "signup" | "signin";
type FieldName = "fullName" | "email" | "password" | "confirm" | "phone";
type Errors = Partial<Record<FieldName, string>>;

const EMPTY = { fullName: "", email: "", password: "", confirm: "", phone: "" };

interface FieldProps {
  name: FieldName;
  label: string;
  type?: string;
  value: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  autoComplete?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  trailing?: React.ReactNode;
}

function Field({
  name,
  label,
  type = "text",
  value,
  error,
  hint,
  optional,
  autoComplete,
  placeholder,
  onChange,
  onBlur,
  trailing,
}: FieldProps) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={name}>
        {label}
        {optional ? <span className="field__optional"> · optional</span> : null}
      </label>

      <div className="field__control">
        <input
          id={name}
          name={name}
          className="input"
          type={type}
          value={value}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        {trailing}
      </div>

      {error ? (
        <p className="field__error" id={`${name}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={`${name}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface AuthPanelProps {
  open: boolean;
  onClose: () => void;
}

export function AuthPanel({ open, onClose }: AuthPanelProps) {
  const { signUp, signIn } = useAuth();
  const { authMode } = useOverlay();
  const [mode, setMode] = useState<Mode>(authMode);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Opening from "Sign in" should land on sign in, not on the sign-up form.
  useEffect(() => {
    if (open) setMode(authMode);
  }, [open, authMode]);

  const set = useCallback((name: FieldName, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    // Clear a field's error as soon as the guest starts fixing it.
    setErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
    setFormError(null);
  }, []);

  const validators = useMemo(
    () => ({
      fullName: () => validateFullName(values.fullName),
      email: () => validateEmail(values.email),
      password: () =>
        mode === "signup" ? validatePassword(values.password) : values.password ? null : "Enter your password.",
      confirm: () =>
        values.confirm === values.password ? null : "Those passwords do not match.",
      phone: () => validatePhone(values.phone),
    }),
    [mode, values],
  );

  const fieldsFor = (current: Mode): FieldName[] =>
    current === "signup" ? ["fullName", "email", "password", "confirm", "phone"] : ["email", "password"];

  const checkField = (name: FieldName) => {
    const message = validators[name]();
    setErrors((current) => ({ ...current, [name]: message ?? undefined }));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const next: Errors = {};
    for (const name of fieldsFor(mode)) {
      const message = validators[name]();
      if (message) next[name] = message;
    }
    setErrors(next);

    const firstInvalid = fieldsFor(mode).find((name) => next[name]);
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLInputElement>(`#${firstInvalid}`)?.focus();
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      if (mode === "signup") {
        await signUp({
          fullName: values.fullName,
          email: values.email,
          password: values.password,
          phone: values.phone || undefined,
        });
      } else {
        await signIn({ email: values.email, password: values.password });
      }
      setValues(EMPTY);
      onClose();
    } catch (error) {
      if (error instanceof AuthError && error.field) {
        setErrors((current) => ({ ...current, [error.field!]: error.message }));
        formRef.current?.querySelector<HTMLInputElement>(`#${error.field}`)?.focus();
      } else {
        setFormError(error instanceof Error ? error.message : "Something went wrong. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  function switchTo(next: Mode) {
    setMode(next);
    setErrors({});
    setFormError(null);
  }

  const signingUp = mode === "signup";

  const reveal = (
    <button
      type="button"
      className="field__reveal"
      aria-label={showPassword ? "Hide password" : "Show password"}
      onClick={() => setShowPassword((value) => !value)}
    >
      {showPassword ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
    </button>
  );

  return (
    <BottomSheet open={open} onClose={onClose} label={signingUp ? "Create your account" : "Sign in"}>
      <SheetHeader
        eyebrow="Account"
        title={signingUp ? "Create your account" : "Welcome back"}
        subtitle={
          signingUp
            ? "Save experiences, complete missions and personalise your stay."
            : "Pick up where you left off."
        }
        onClose={onClose}
      />

      <div className="sheet__scroll scroll-region">
        <form className="auth-form" ref={formRef} onSubmit={submit} noValidate>
          {signingUp ? (
            <Field
              name="fullName"
              label="Full name"
              value={values.fullName}
              error={errors.fullName}
              autoComplete="name"
              placeholder="Nino Beridze"
              onChange={(value) => set("fullName", value)}
              onBlur={() => checkField("fullName")}
            />
          ) : null}

          <Field
            name="email"
            label="Email"
            type="email"
            value={values.email}
            error={errors.email}
            autoComplete="email"
            placeholder="you@example.com"
            onChange={(value) => set("email", value)}
            onBlur={() => checkField("email")}
          />

          <Field
            name="password"
            label="Password"
            type={showPassword ? "text" : "password"}
            value={values.password}
            error={errors.password}
            hint={signingUp ? PASSWORD_HINT : undefined}
            autoComplete={signingUp ? "new-password" : "current-password"}
            onChange={(value) => set("password", value)}
            onBlur={() => checkField("password")}
            trailing={reveal}
          />

          {signingUp ? (
            <>
              <Field
                name="confirm"
                label="Confirm password"
                type={showPassword ? "text" : "password"}
                value={values.confirm}
                error={errors.confirm}
                autoComplete="new-password"
                onChange={(value) => set("confirm", value)}
                onBlur={() => checkField("confirm")}
              />
              <Field
                name="phone"
                label="Phone number"
                type="tel"
                value={values.phone}
                error={errors.phone}
                optional
                autoComplete="tel"
                placeholder="+995 555 00 00 00"
                onChange={(value) => set("phone", value)}
                onBlur={() => checkField("phone")}
              />
            </>
          ) : null}

          {formError ? (
            <p className="auth-form__error" role="alert">
              {formError}
            </p>
          ) : null}

          <button type="submit" className="btn btn--block" disabled={busy}>
            <UserPlus size={15} strokeWidth={2.2} aria-hidden="true" />
            {busy
              ? signingUp
                ? "Creating…"
                : "Signing in…"
              : signingUp
                ? "Create account"
                : "Sign in"}
          </button>

          <p className="auth-form__switch">
            {signingUp ? "Already have an account?" : "New here?"}{" "}
            <button type="button" className="link" onClick={() => switchTo(signingUp ? "signin" : "signup")}>
              {signingUp ? "Sign in" : "Create one"}
            </button>
          </p>

          <div className="auth-form__guest">
            <span className="rule" aria-hidden="true" />
            <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
              Continue as guest
            </button>
            <p className="field__hint" style={{ textAlign: "center" }}>
              The map, missions and the scanner all work without an account.
            </p>
          </div>
        </form>
      </div>
    </BottomSheet>
  );
}
