import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import UserBadge from '../security/UserBadge.jsx';

export default function Devices() {
  const [serialNumber, setSerialNumber] = useState('');
  const [search, setSearch] = useState({ completed: false, loading: false, device: null, errors: [] });

  async function searchProvider(provider, url) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const apiErrors = Array.isArray(body?.errors)
          ? body.errors.map(error => typeof error === 'string' ? error : error?.message || JSON.stringify(error))
          : [];
        const details = apiErrors.length ? apiErrors.join('; ') : body?.reason || body?.message;
        throw new Error(details || `request failed (${response.status})`);
      }
      return body;
    } catch (error) {
      throw new Error(`${provider}: ${error?.message || 'request failed'}`);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const serial = serialNumber.trim();
    if (!serial) return;

    setSearch({ completed: false, loading: true, device: null, errors: [] });
    const query = new URLSearchParams({ serialNumber: serial });
    const results = await Promise.allSettled([
      searchProvider('Microsoft Intune', `/api/devices/intune?${query}`),
      searchProvider('Mosyle', `/api/devices/mosyle?${query}`),
    ]);
    const matches = results
      .filter(result => result.status === 'fulfilled' && result.value?.found)
      .map(result => result.value);
    const errors = results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason?.message || String(result.reason));
    setSearch({
      completed: true,
      loading: false,
      device: matches[0] || null,
      errors,
    });
  }

  return (
    <>
      <UserBadge />
      <main>
        <section className="card" aria-labelledby="devices-title">
          <p className="muted" style={{ margin: 0 }}>IT Admin Portal</p>
          <h1 id="devices-title" style={{ marginTop: 6 }}>Devices</h1>
          <p className="muted">Find a device by its serial number.</p>
          <form onSubmit={handleSubmit} role="search">
            <div className="field">
              <label htmlFor="serial-number">Serial number</label>
              <input
                id="serial-number"
                name="serialNumber"
                type="search"
                value={serialNumber}
                onChange={event => setSerialNumber(event.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="toolbar" style={{ marginTop: 14 }}>
              <button className="primary" type="submit" disabled={search.loading}>
                {search.loading ? 'Searching…' : 'Search'}
              </button>
              <Link to="/">Back to home</Link>
            </div>
          </form>
        </section>
        {search.errors.length > 0 && (
          <section className="card" aria-labelledby="search-errors-title" aria-live="polite">
            <h2 id="search-errors-title" style={{ marginTop: 0 }}>Search errors</h2>
            <ul className="err" style={{ marginBottom: 0 }}>
              {search.errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
            </ul>
          </section>
        )}
        {search.completed && (
          <section className="card" aria-labelledby="device-result-title">
            <h2 id="device-result-title" style={{ marginTop: 0 }}>Device details</h2>
            {!search.device && <p className="muted">No device was found.</p>}
            <dl>
              <dt className="muted">Device serial</dt>
              <dd>{search.device?.device?.serialNumber || '—'}</dd>
              <dt className="muted">Device name</dt>
              <dd>{search.device?.device?.deviceName || '—'}</dd>
              <dt className="muted">Assigned user</dt>
              <dd>{search.device?.device?.assignedUser || '—'}</dd>
              {search.device && (
                <>
                  <dt className="muted">Source</dt>
                  <dd>{search.device.source === 'intune' ? 'Microsoft Intune' : 'Mosyle'}</dd>
                </>
              )}
            </dl>
          </section>
        )}
      </main>
    </>
  );
}
