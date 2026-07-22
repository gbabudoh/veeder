/**
 * Presentational pagination controls.
 *
 * Renders Prev/Next buttons plus current page info. Prev is disabled on the
 * first page; Next is disabled once the current page reaches the last page of
 * results (`page * pageSize >= total`). Purely presentational: page changes are
 * emitted via `onPageChange` and the caller owns the fetching.
 *
 * Requirements: 12.5
 */

export interface PaginationProps {
  /** Current 1-based page number. */
  page: number;
  /** Number of records per page. */
  pageSize: number;
  /** Total number of records across all pages. */
  total: number;
  /** Called with the target 1-based page when Prev/Next is activated. */
  onPageChange: (page: number) => void;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: PaginationProps): JSX.Element {
  const isFirstPage = page <= 1;
  const isLastPage = page * pageSize >= total;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="pagination__prev"
        onClick={() => onPageChange(page - 1)}
        disabled={isFirstPage}
      >
        Prev
      </button>
      <span className="pagination__info" aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="pagination__next"
        onClick={() => onPageChange(page + 1)}
        disabled={isLastPage}
      >
        Next
      </button>
    </nav>
  );
}

export default Pagination;
