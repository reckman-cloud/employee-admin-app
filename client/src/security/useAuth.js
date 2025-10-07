export async function getClientPrincipal({ signal } = {}){
  const r = await fetch('/.auth/me', { signal, cache: 'no-store' }).catch(()=>null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(()=>null);
  return j?.clientPrincipal || null;
}
export function hasRole(p, role){ return Boolean(p?.userRoles?.includes(role)); }
export function isSignedIn(p){ return Boolean(p && p.userRoles?.includes('authenticated')); }
