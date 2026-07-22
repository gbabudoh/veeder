/**
 * Presentational empty-results message.
 *
 * Shown when a successful request returns zero records. Uses `role="status"`
 * so the empty result is announced. Purely presentational.
 *
 * Requirements: 12.7, 15.6
 */

export interface EmptyStateProps {
  /** Message describing the empty result. */
  message: string;
}

export function EmptyState({ message }: EmptyStateProps): JSX.Element {
  return (
    <div role="status" aria-live="polite" className="empty-state">
      <p className="empty-state__message">{message}</p>
    </div>
  );
}

export default EmptyState;
