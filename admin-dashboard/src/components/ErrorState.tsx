/**
 * Presentational error message with an optional retry control.
 *
 * Shown when a request fails. Uses `role="alert"` so the failure is announced
 * assertively. When `onRetry` is provided, renders a real <button> wired to it.
 * Purely presentational — retry semantics are owned by the caller.
 *
 * Requirements: 12.8, 13.3, 13.5, 14.5, 14.7, 15.7, 15.8
 */

export interface ErrorStateProps {
  /** Human-readable error message. */
  message: string;
  /** Optional retry handler. When provided, a "Retry" button is rendered. */
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps): JSX.Element {
  return (
    <div role="alert" className="error-state">
      <p className="error-state__message">{message}</p>
      {onRetry !== undefined ? (
        <button type="button" className="btn btn--ghost btn--sm error-state__retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export default ErrorState;
