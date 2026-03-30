/**
 * Skeleton placeholders for the groups dashboard grid and participants list.
 * Tile skeletons are decorative (`aria-hidden`). The list skeleton uses a live
 * status region, consistent with FullPageLoading.
 */
export function GroupsDashboardCreateTileSkeleton() {
  return (
    <div
      className="groups-dashboard-create-tile groups-dashboard-create-tile--skeleton"
      aria-hidden="true"
    >
      <span className="app-skeleton-block app-skeleton-block--plus" />
    </div>
  )
}

export function GroupsDashboardTileSkeleton() {
  return (
    <div
      className="groups-dashboard-group-tile groups-dashboard-group-tile--skeleton"
      aria-hidden="true"
    >
      <div className="groups-dashboard-group-tile-banner app-skeleton-block" />
      <div className="groups-dashboard-group-tile-body">
        <div className="app-skeleton-line app-skeleton-line--member-row" />
        <div className="app-skeleton-line app-skeleton-line--title" />
        <div className="app-skeleton-line app-skeleton-line--meta" />
      </div>
    </div>
  )
}

export function ParticipantsListSkeleton({ count = 5 }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="participants-list-skeleton">
      <span className="visually-hidden">Loading participants</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="participant-item participant-item--skeleton" aria-hidden="true">
          <div className="participant-item__main">
            <div className="app-skeleton-block app-skeleton-block--avatar" />
            <div className="participant-item__text">
              <div className="app-skeleton-line app-skeleton-line--name" />
              <div className="app-skeleton-line app-skeleton-line--badges" />
            </div>
          </div>
          <div className="app-skeleton-block app-skeleton-block--menu" />
        </div>
      ))}
    </div>
  )
}
