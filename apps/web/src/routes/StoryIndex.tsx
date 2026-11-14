import { Navigate, useLocation } from 'react-router-dom';

/** `/story` → `/story/1`, keeping any query. */
export function Component() {
  const { search } = useLocation();
  return <Navigate to={`/story/1${search}`} replace />;
}
