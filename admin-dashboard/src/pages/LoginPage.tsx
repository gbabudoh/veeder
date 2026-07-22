/**
 * Admin login screen.
 *
 * Renders an email + password form, validates the fields client-side BEFORE
 * contacting the server, and maps the {@link LoginOutcome} from the session
 * provider onto user-facing behavior:
 *
 * - `admin`    → navigate to the originally-requested location or `/analytics`.
 * - `not-admin`→ show an "administrator privileges required" message.
 * - `invalid`  → show a generic invalid-credentials message.
 * - `error`    → show a retryable generic error (also covers the 30s timeout).
 *
 * A 30-second timeout races the login attempt (Req 10.6, 10.7) and an
 * `isSubmitting` guard blocks a second concurrent submission (Req 10.6).
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { useSession, type LoginOutcome } from '../auth/SessionProvider';

/** Default landing view after a successful admin login (Req 10.2). */
const DEFAULT_REDIRECT = '/overview';

/** Login request timeout in milliseconds (Req 10.1, 10.6, 10.7). */
const LOGIN_TIMEOUT_MS = 30_000;

/** Field-level validation messages produced by {@link validateLoginFields}. */
export interface LoginFieldErrors {
  email?: string;
  password?: string;
}

/** Result of validating the login form fields. */
export type LoginValidationResult =
  | { ok: true }
  | { ok: false; errors: LoginFieldErrors };

/**
 * Pure validation of the login form fields (Req 10.5).
 *
 * Rules:
 * - Email must be non-empty.
 * - Email must match `local-part@domain`: EXACTLY ONE `@`, a non-empty local
 *   part (at least one character before the `@`), and at least one `.` in the
 *   domain portion (after the `@`).
 * - Password must be non-empty.
 *
 * Kept pure and exported so it can be unit/property tested in isolation
 * (property test target 15.7) and reused by the submit handler.
 */
export function validateLoginFields(
  email: string,
  password: string,
): LoginValidationResult {
  const errors: LoginFieldErrors = {};

  if (email.length === 0) {
    errors.email = 'Email is required.';
  } else if (!isValidEmail(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (password.length === 0) {
    errors.password = 'Password is required.';
  }

  if (errors.email !== undefined || errors.password !== undefined) {
    return { ok: false, errors };
  }
  return { ok: true };
}

/**
 * Email pattern check: exactly one `@`, a non-empty local part, and at least
 * one `.` in the domain part.
 */
function isValidEmail(email: string): boolean {
  const atIndex = email.indexOf('@');
  // Exactly one '@' means the first '@' is also the last '@'.
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) {
    return false;
  }
  const domain = email.slice(atIndex + 1);
  return domain.includes('.');
}

/** Top-level (non-field) message shown above the form. */
interface TopMessage {
  kind: 'error' | 'info';
  text: string;
  /** When true, the message represents a retryable error state (Req 10.7). */
  retryable: boolean;
}

/**
 * Extract the originally-requested path stashed by the protected-route guard
 * (`state.from`), falling back to the default landing view.
 */
function resolveRedirectPath(state: unknown): string {
  if (
    typeof state === 'object' &&
    state !== null &&
    'from' in state
  ) {
    const from = (state as { from?: Partial<Location> }).from;
    if (
      from !== undefined &&
      typeof from.pathname === 'string' &&
      from.pathname.length > 0
    ) {
      return from.pathname;
    }
  }
  return DEFAULT_REDIRECT;
}

/**
 * Race a promise against a timeout. When the timeout elapses first the returned
 * promise resolves to `{ status: 'error' }` (Req 10.7), matching the
 * {@link LoginOutcome} shape so callers treat a timeout as a generic error.
 */
function withTimeout(
  attempt: Promise<LoginOutcome>,
  timeoutMs: number,
): Promise<LoginOutcome> {
  return new Promise<LoginOutcome>((resolve) => {
    const timer = setTimeout(() => resolve({ status: 'error' }), timeoutMs);
    attempt.then(
      (outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      },
      () => {
        clearTimeout(timer);
        resolve({ status: 'error' });
      },
    );
  });
}

/**
 * The admin login page component.
 */
export default function LoginPage(): JSX.Element {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [message, setMessage] = useState<TopMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // Block a second concurrent submission while a request is in flight
    // (Req 10.6).
    if (isSubmitting) {
      return;
    }

    // Validate FIRST; on any invalid field show messages and do NOT send a
    // request (Req 10.5).
    const validation = validateLoginFields(email, password);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      setMessage(null);
      return;
    }

    setFieldErrors({});
    setMessage(null);
    setIsSubmitting(true);

    // Race the login attempt against the 30s timeout (Req 10.1, 10.7).
    const outcome = await withTimeout(
      login(email, password),
      LOGIN_TIMEOUT_MS,
    );

    switch (outcome.status) {
      case 'admin':
        // Navigate to the originally-requested location or the default view
        // (Req 10.2, 16.5).
        navigate(resolveRedirectPath(location.state), { replace: true });
        return;
      case 'not-admin':
        // Stay on login; report that admin privileges are required (Req 10.3).
        setMessage({
          kind: 'error',
          text: 'This account does not have administrator privileges.',
          retryable: false,
        });
        setIsSubmitting(false);
        return;
      case 'invalid':
        // Generic invalid-credentials message (Req 10.4).
        setMessage({
          kind: 'error',
          text: 'Invalid email or password.',
          retryable: false,
        });
        setIsSubmitting(false);
        return;
      case 'error':
      default:
        // Generic, retryable error (incl. timeout) (Req 10.7).
        setMessage({
          kind: 'error',
          text: 'Sign-in could not be completed. Please try again.',
          retryable: true,
        });
        setIsSubmitting(false);
        return;
    }
  }

  return (
    <div className="login-wrapper">
      <div className="login-panel">
        <div className="login-card">
          <div className="login-card__brand">
            <div className="login-card__brand-mark">V</div>
            <div>
              <div className="login-card__brand-name">Veeder <span>Admin</span></div>
            </div>
          </div>

          <h1>Welcome back</h1>
          <p className="login-card__sub">Sign in with your administrator account to continue.</p>

          {message !== null && (
            <div role="alert" className="alert alert--error">
              <p>{message.text}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-field">
              <label htmlFor="login-email">Email address</label>
              <input
                id="login-email" name="email" type="email"
                autoComplete="username" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                aria-invalid={fieldErrors.email !== undefined}
                aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
              />
              {fieldErrors.email && <p id="login-email-error" className="form-field__error">{fieldErrors.email}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password" name="password" type="password"
                autoComplete="current-password" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                aria-invalid={fieldErrors.password !== undefined}
                aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
              />
              {fieldErrors.password && <p id="login-password-error" className="form-field__error">{fieldErrors.password}</p>}
            </div>
            <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>
        </div>
      </div>

      <div className="login-art">
        <div className="login-art__inner">
          <div className="login-art__icon">🛡️</div>
          <h2>Veeder Admin Console</h2>
          <p>Monitor users, review authentication activity, and analyse platform health — all in one place.</p>
        </div>
      </div>
    </div>
  );
}
