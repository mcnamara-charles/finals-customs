import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './authContext'

export function ProtectedRoute({ children }) {
  const { session, authReady } = useAuth()
  const location = useLocation()

  if (!authReady) {
    return (
      <div className="access-gate-page">
        <div className="access-gate-card">
          <h1 className="access-gate-title">The Finals Customs</h1>
          <p className="access-gate-help">Loading…</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}
