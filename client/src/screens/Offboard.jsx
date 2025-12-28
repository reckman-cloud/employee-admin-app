import React, { useEffect, useMemo, useState } from 'react';
import { API, fetchLists } from '../api.js';
import UserBadge from '../security/UserBadge.jsx';

export default function Offboard() {
  const [managers, setManagers] = useState([]);
  const [form, setForm] = useState({ query: '', managerId: '', notes: '' });
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      const data = await fetchLists();
      if (!alive) return;
      setManagers(data.managers);
    })();

    return () => {
      alive = false;
    };
  }, []);

  const selectedManager = useMemo(
    () => managers.find(manager => manager.id === form.managerId) || null,
    [managers, form.managerId],
  );

  const terminate = async event => {
    event.preventDefault();
    const employee = form.query.trim();

    if (!employee) {
      setStatus('Enter a user to offboard.');
      return;
    }

    setSubmitting(true);
    setStatus('');

    try {
      const payload = {
        employee,
        managerId: selectedManager?.id || '',
        managerUpn: selectedManager?.upn || '',
        managerName: selectedManager?.name || '',
        notes: form.notes.trim(),
      };

      const response = await fetch(API.offboard, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error('Request failed');

      setStatus('Termination request queued.');
      setForm({ query: '', managerId: '', notes: '' });
    } catch {
      setStatus('Failed to queue termination request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <UserBadge />
      <main>
        <section className="card" aria-labelledby="offboard-title">
          <p className="muted" style={{ margin: 0 }}>IT Admin Portal</p>
          <h1 id="offboard-title" style={{ marginTop: 6 }}>Offboarding</h1>
          <p className="muted" style={{ maxWidth: 580 }}>
            Queue a termination request for an employee. Manager options reuse the same directory data that powers the onboarding form.
          </p>

          <form className="stack" onSubmit={terminate} style={{ gap: 16, marginTop: 12 }}>
            <div className="field">
              <label htmlFor="employee-search">Employee search</label>
              <input
                id="employee-search"
                name="employee"
                type="search"
                placeholder="Search by email, name, or UPN"
                value={form.query}
                onChange={event => setForm(previous => ({ ...previous, query: event.target.value }))}
                required
              />
              <p className="muted" style={{ marginTop: 4 }}>Provide the employee identifier to send to the queue.</p>
            </div>

            <div className="field">
              <label htmlFor="manager-select">Manager</label>
              <select
                id="manager-select"
                name="manager"
                value={form.managerId}
                onChange={event => setForm(previous => ({ ...previous, managerId: event.target.value }))}
              >
                <option value="">Select (optional)</option>
                {managers.map(manager => (
                  <option key={manager.id} value={manager.id}>
                    {manager.name} · {manager.title} · {manager.department}
                  </option>
                ))}
              </select>
              <p className="muted" style={{ marginTop: 4 }}>
                Managers come from the same directory list used in the onboarding form.
              </p>
            </div>

            <div className="field">
              <label htmlFor="notes">Notes (optional)</label>
              <textarea
                id="notes"
                name="notes"
                rows="3"
                placeholder="Add context for downstream systems"
                value={form.notes}
                onChange={event => setForm(previous => ({ ...previous, notes: event.target.value }))}
              />
            </div>

            <div className="toolbar" style={{ alignItems: 'center' }}>
              <button className="primary" type="submit" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Terminate Employee'}
              </button>
              {status && (
                <span className="muted" role="status" aria-live="polite">
                  {status}
                </span>
              )}
            </div>
          </form>
        </section>
      </main>
    </>
  );
}
