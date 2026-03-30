import { Navigate, useLocation } from 'react-router-dom'
import { FullPageLoading } from '../components/FullPageLoading'
import { useAuth } from './authContext'

export function ProtectedRoute({ children }) {
  const { session, authReady } = useAuth()
  const location = useLocation()

  if (!authReady) {
    return <FullPageLoading label="Loading session" />
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}
