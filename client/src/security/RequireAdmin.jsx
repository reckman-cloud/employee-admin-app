import React, { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getClientPrincipal, isSignedIn, hasRole } from './useAuth';

export default function RequireAdmin({ children, allowedRoles = ['it_admin'] }){
  const [state, setState] = useState({ loading: true, principal: null });
  const abortRef = useRef(null);
  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController(); abortRef.current = ac;
    const t = setTimeout(()=> ac.abort('timeout'), 8000);
    (async () => { const p = await getClientPrincipal({ signal: ac.signal }); setState({ loading: false, principal: p }); })().finally(()=> clearTimeout(t));
    return () => { ac.abort(); };
  }, []);
  if (state.loading) return (<div className="center card"><h2>Checking access…</h2><p className="muted">Verifying your access.</p></div>);
  const signedIn = isSignedIn(state.principal);
  const authorized = allowedRoles.some(role => hasRole(state.principal, role));
  if (!signedIn) return <Navigate to="/signin" replace/>;
  if (!authorized) return (<div className="center card"><h2>Forbidden</h2><p className="muted">You’re signed in, but do not have access to this page.</p><p><a href="/logout"><button>Sign out</button></a></p></div>);
  return children;
}
