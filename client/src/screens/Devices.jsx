import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import UserBadge from '../security/UserBadge.jsx';

export default function Devices() {
  const [serialNumber, setSerialNumber] = useState('');
  const [search, setSearch] = useState({ completed: false, loading: false, device: null, error: '' });

  async function handleSubmit(event) {
    event.preventDefault();
    const serial = serialNumber.trim();
    if (!serial) return;

    setSearch({ completed: false, loading: true, device: null, error: '' });
    const query = new URLSearchParams({ serialNumber: serial });
    const results = await Promise.allSettled([
      fetch(`/api/devices/intune?${query}`, { cache: 'no-store' }).then(async response => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.reason || 'intune-search-failed');
        return body;
      }),
      fetch(`/api/devices/mosyle?${query}`, { cache: 'no-store' }).then(async response => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.reason || 'mosyle-search-failed');
        return body;
      }),
    ]);
    const matches = results
      .filter(result => result.status === 'fulfilled' && result.value?.found)
      .map(result => result.value);
    const incompleteSearch = matches.length === 0 && results.some(result => result.status === 'rejected');
    setSearch({
      completed: true,
      loading: false,
      device: matches[0] || null,
      error: incompleteSearch ? 'The device services could not be searched. Please try again.' : '',
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
        {search.completed && (
          <section className="card" aria-labelledby="device-result-title">
            <h2 id="device-result-title" style={{ marginTop: 0 }}>Device details</h2>
            {search.error && <p className="err" role="alert">{search.error}</p>}
            {!search.error && !search.device && <p className="muted">No device was found.</p>}
            {!search.error && (
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
            )}
          </section>
        )}
      </main>
    </>
  );
}
