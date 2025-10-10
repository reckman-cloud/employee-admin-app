// client/src/security/UserBadge.jsx
import React, { useEffect, useState } from 'react';
import { getClientPrincipal } from './useAuth';

function deriveName(p) {
  const u = p?.userDetails || '';
  if (!u) return 'Signed in';
  const left = u.split('@')[0] || u;
  return left.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function UserBadge() {
  const [principal, setPrincipal] = useState(null);

  useEffect(() => {
    const ac = new AbortController();
    getClientPrincipal({ signal: ac.signal }).then(setPrincipal).catch(() => setPrincipal(null));
    return () => ac.abort();
  }, []);

  const name = deriveName(principal);
  const upn = principal?.userDetails || '';

  // why: inline styles avoid editing global CSS; matches existing tokens
  const box = {
    position: 'fixed', top: 12, right: 12, zIndex: 1000,
    background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 10,
    display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 4px 14px rgba(0,0,0,0.25)'
  };
  const nameCss = { fontSize: 14, margin: 0 };
  const upnCss = { fontSize: 12, margin: 0, color: 'var(--muted)' };

  return (
    <div aria-live="polite" aria-label="Signed-in user" style={box}>
      <div style={{ lineHeight: 1.2 }}>
        <p style={nameCss}>{name}</p>
        <p style={upnCss}>{upn}</p>
      </div>
      <a href="/logout" style={{ textDecoration: 'none' }}>
        <button type="button" className="ghost small">Sign out</button>
      </a>
    </div>
  );
}
