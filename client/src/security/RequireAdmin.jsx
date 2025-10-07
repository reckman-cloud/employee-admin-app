import React, { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getClientPrincipal, isSignedIn, hasRole } from './useAuth';

export default function RequireAdmin({ children }){
  const [state, setState] = useState({ loading: true, principal: null });
  const abortRef = useRef(null);
  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController(); abortRef.current = ac;
    const t = setTimeout(()=> ac.abort('timeout'), 8000);
    (async () => { const p = await getClientPrincipal({ signal: ac.signal }); setState({ loading: false, principal: p }); })().finally(()=> clearTimeout(t));
    return () => { ac.abort(); };
  }, []);
  if (state.loading) return (<div className="center card"><h2>Checking access…</h2><p className="muted">Verifying your admin role.</p></div>);
  const signedIn = isSignedIn(state.principal); const admin = hasRole(state.principal, 'it-admin');
  if (!signedIn) return <Navigate to="/signin" replace/>;
  if (!admin) return (<div className="center card"><h2>Forbidden</h2><p className="muted">You’re signed in, but not an IT admin.</p><p><a href="/logout"><button>Sign out</button></a></p></div>);
  return children;
}
