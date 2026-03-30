/**
 * Full-viewport loading state with accessible status semantics.
 */
export function FullPageLoading({ label = 'Loading' }) {
  return (
    <div
      className="access-gate-page app-full-page-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="visually-hidden">{label}</span>
      <div className="app-full-page-loading__spinner" aria-hidden="true" />
      <p className="access-gate-title app-full-page-loading__brand" aria-hidden="true">
        The Finals Customs
      </p>
    </div>
  )
}
