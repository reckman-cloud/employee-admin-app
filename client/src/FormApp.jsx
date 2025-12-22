import React, { useEffect, useMemo, useRef, useState } from 'react';
import UserBadge from './security/UserBadge.jsx';

// Central list of backend endpoints used throughout the form.
const API = {
  lists: '/api/lists',
  submitAll: '/api/submit-all',
  health: '/api/health',
};

// LocalStorage key for persisting saved employee entries between sessions.
const STORAGE_KEY = 'emp_entries_v1';

// Lightweight UUID helper with a deterministic fallback for environments
// that lack the Web Crypto API (e.g. older browsers).
const uuid = () =>
  crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const value = c === 'x' ? (Math.random() * 16) | 0 : ((Math.random() * 16) | 0) & 0x3 | 0x8;
    return value.toString(16);
  });

const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatStartDate = raw => {
  if (!raw) return '';

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';

  const month = MONTH_ABBREVS[parsed.getUTCMonth()];
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  const year = parsed.getUTCFullYear();
  return `${month}${day},${year}`;
};

function useLocalStorage(key, initialValue) {
  // Hydrate state from localStorage on first render and mirror updates back
  // to storage so saved entries survive reloads.
  const [state, setState] = useState(() => {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  return [state, setState];
}

function HealthBadge() {
  const [state, setState] = useState({ cls: 'checking', text: 'Checking…' });
  const controllerRef = useRef(null);

  const check = async () => {
    controllerRef.current?.abort();

    const ac = new AbortController();
    controllerRef.current = ac;
    setState({ cls: 'checking', text: 'Checking…' });

    const timeout = setTimeout(() => ac.abort('timeout'), 8000);

    try {
      const response = await fetch(API.health, { signal: ac.signal });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setState({ cls: 'error', text: 'Error' });
        return;
      }

      if (!data?.ok) {
        setState({ cls: 'warn', text: 'Degraded' });
        return;
      }

      const queueLabel = data?.queue?.name
        ? `OK · ${data.queue.name}${
            Number.isFinite(data.queue.approximateMessagesCount)
              ? ` (~${data.queue.approximateMessagesCount})`
              : ''
          }`
        : 'OK';

      setState({ cls: 'ok', text: queueLabel });
    } catch {
      const online = navigator.onLine;
      setState({ cls: online ? 'error' : 'offline', text: online ? 'Error' : 'Offline' });
    } finally {
      clearTimeout(timeout);
    }
  };

  useEffect(() => {
    check();

    const id = setInterval(() => {
      if (!document.hidden) check();
    }, 30000);

    return () => {
      clearInterval(id);
      controllerRef.current?.abort();
    };
  }, []);

  // Status badge that continuously reflects queue health and lets the user
  // manually re-run the check via the refresh button.
  return (
    <div className={`health ${state.cls}`} role="status" aria-live="polite" title="Queue health">
      <span className="dot" aria-hidden="true"></span>
      <span style={{ fontSize: 12, color: '#9196a1' }}>{state.text}</span>
      <button className="ghost small" type="button" onClick={check}>
        ↻
      </button>
    </div>
  );
}

function ManagerComboBox({ managers, value, onSelect, error }) {
  const [query, setQuery] = useState(value?.name || '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const items = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return managers.slice(0, 8);

    // Score managers using a quick-and-dirty relevance metric so the most
    // likely matches appear first, even when users partially type names.
    const score = m => {
      const name = m.name.toLowerCase();
      const title = (m.title || '').toLowerCase();
      const department = (m.department || '').toLowerCase();
      const upn = (m.upn || '').toLowerCase();

      let sc = 0;
      if (name.startsWith(search)) sc += 3;
      if (name.includes(search)) sc += 2;
      if (upn.includes(search)) sc += 2;
      if (title.includes(search)) sc += 1;
      if (department.includes(search)) sc += 1;
      return sc;
    };

    return managers
      .map(m => [score(m), m])
      .filter(([sc]) => sc > 0)
      .sort((a, b) => b[0] - a[0])
      .map(([, m]) => m)
      .slice(0, 8);
  }, [query, managers]);

  useEffect(() => {
    setQuery(value?.name || '');
  }, [value]);

  const choose = manager => {
    onSelect(manager);
    setQuery(manager.name);
    setOpen(false);
  };

  const onKey = event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index => Math.min(items.length - 1, index + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(0, index - 1));
      return;
    }

    if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault();
      choose(items[activeIndex]);
      return;
    }

    if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="field" aria-describedby="manager-err">
      <label htmlFor="manager">
        Manager <span className="muted">• required</span>
      </label>

      <div className="combo" role="combobox" aria-haspopup="listbox" aria-expanded={open}>
        <input
          id="manager"
          name="manager"
          type="text"
          autoComplete="off"
          aria-controls="manager-listbox"
          aria-autocomplete="list"
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            onSelect(null);
            setOpen(true);
          }}
          onKeyDown={onKey}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          className={error ? 'error' : ''}
        />

        {!open ? null : (
          <ul id="manager-listbox" className="listbox" role="listbox">
            {items.length ? (
              items.map((manager, index) => (
                <li
                  key={manager.id}
                  className={`option ${index === activeIndex ? 'active' : ''}`}
                  role="option"
                  onMouseDown={event => {
                    event.preventDefault();
                    choose(manager);
                  }}
                >
                  <strong>{manager.name}</strong>
                  <span className="opt-sub">
                    {manager.title} · {manager.department}
                    {manager.upn ? ` · ${manager.upn}` : ''}
                  </span>
                </li>
              ))
            ) : (
              <div className="nores" role="note" style={{ padding: '8px 10px', color: '#a6abb6' }}>
                No results
              </div>
            )}
          </ul>
        )}
      </div>

      <div id="manager-err" className="err" aria-live="polite">
        {error || ''}
      </div>
    </div>
  );
}

function EntriesTable({ entries, onEdit, onDelete }) {
  if (!entries.length) {
    return <div className="muted" id="empty-state">No entries yet. Submit the form to see items here.</div>;
  }

  // Render a compact summary of saved entries with edit/delete controls.
  return (
    <div id="entries-wrap">
      <table aria-describedby="entries-count">
        <thead>
          <tr>
            <th>First</th>
            <th>Last</th>
            <th>Title</th>
            <th>Department</th>
            <th>Business Unit</th>
            <th>Start Date</th>
            <th>Full Time</th>
            <th>Manager</th>
            <th style={{ width: 180 }}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {entries.map(entry => (
            <tr key={entry.id}>
              <td>{entry.firstName}</td>
              <td>{entry.lastName}</td>
              <td>{entry.title}</td>
              <td>{entry.department}</td>
              <td>
                <span className="chip">{entry.businessUnit}</span>
              </td>
              <td>
                <span className="chip">{formatStartDate(entry.startDate)}</span>
              </td>
              <td>
                <span className="chip">{entry.fullTime ? 'Yes' : 'No'}</span>
              </td>
              <td>
                <span className="chip">{entry.managerName || entry.managerUpn || entry.managerId}</span>
              </td>
              <td>
                <button type="button" onClick={() => onEdit(entry.id)}>
                  Edit
                </button>{' '}
                <button type="button" onClick={() => onDelete(entry.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FormApp() {
  // Form field values, select lists, local storage cache, and UI helpers.
  const [lists, setLists] = useState({ departments: [], businessUnits: [], managers: [] });
  const defaultStartDate = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };

  const [form, setForm] = useState({
    id: null,
    firstName: '',
    lastName: '',
    title: '',
    department: '',
    businessUnit: '',
    managerId: '',
    managerUpn: '',
    managerName: '',
    fullTime: true,
    startDate: defaultStartDate(),
  });
  const [errors, setErrors] = useState({});
  const [entries, setEntries] = useLocalStorage(STORAGE_KEY, []);
  const [toast, setToast] = useState('');

  const unsubmitted = useMemo(
    () => entries.filter(entry => !entry._meta?.submittedAt).length,
    [entries],
  );

  // Lightweight toast helper for success/failure notices.
  const showToast = message => {
    setToast(message);
    setTimeout(() => setToast(''), 1600);
  };

  useEffect(() => {
    let alive = true;

    // Fetch select lists on mount. We guard on `alive` so state isn't set
    // after unmount (e.g., during navigation in tests or previews).
    (async () => {
      try {
        const response = await fetch(API.lists, { cache: 'no-store' });
        const data = await response.json();

        if (!response.ok) throw new Error();
        if (!alive) return;

        setLists({
          departments: data.departments || [],
          businessUnits: data.businessUnits || [],
          managers: data.managers || [],
        });
      } catch {
        setLists({ departments: [], businessUnits: [], managers: [] });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const setField = (key, value) => setForm(previous => ({ ...previous, [key]: value }));

  // Basic client-side validation for required fields and minimum lengths.
  const validate = () => {
    const validationErrors = {};

    if (!form.firstName || form.firstName.trim().length < 2) {
      validationErrors.firstName = 'First name is required';
    }

    if (!form.lastName || form.lastName.trim().length < 2) {
      validationErrors.lastName = 'Last name is required';
    }

    if (!form.title || form.title.trim().length < 2) {
      validationErrors.title = 'Title is required';
    }

    if (!form.department) {
      validationErrors.department = 'Department is required';
    }

    if (!form.businessUnit) {
      validationErrors.businessUnit = 'Business Unit is required';
    }

    if (!form.managerId) {
      validationErrors.manager = 'Select a manager from the list';
    }

    if (!form.startDate) {
      validationErrors.startDate = 'Start date is required';
    }

    setErrors(validationErrors);
    return !Object.keys(validationErrors).length;
  };

  const resetForm = () => {
    setForm({
      id: null,
      firstName: '',
      lastName: '',
      title: '',
      department: '',
      businessUnit: '',
      managerId: '',
      managerUpn: '',
      managerName: '',
      fullTime: true,
      startDate: defaultStartDate(),
    });
    setErrors({});
  };

  // Add a new entry or update the currently edited one in local storage.
  const saveEntry = event => {
    event.preventDefault();
    if (!validate()) return;

    const now = new Date().toISOString();

    setEntries(previous =>
      form.id
        ? previous.map(entry =>
            entry.id === form.id
              ? { ...form, _meta: { ...(entry._meta || {}), savedAt: now, schema: 4 } }
              : entry,
          )
        : [
            ...previous,
            { ...form, id: uuid(), _meta: { savedAt: now, submittedAt: null, schema: 4 } },
          ],
    );

    resetForm();
    showToast('Saved.');
  };

  // Populate the form with an existing entry for editing.
  const editEntry = id => {
    const existing = entries.find(entry => entry.id === id);
    if (!existing) return;

    setForm({
      id: existing.id,
      firstName: existing.firstName,
      lastName: existing.lastName,
      title: existing.title,
      department: existing.department,
      businessUnit: existing.businessUnit,
      managerId: existing.managerId,
      managerUpn: existing.managerUpn || '',
      managerName: existing.managerName || '',
      fullTime: typeof existing.fullTime === 'boolean' ? existing.fullTime : true,
      startDate: existing.startDate || defaultStartDate(),
    });
  };

  // Remove a single entry from the local cache.
  const deleteEntry = id => setEntries(previous => previous.filter(entry => entry.id !== id));

  // Prompted reset of all cached entries.
  const clearAll = () => {
    if (!entries.length) return;
    if (confirm('Clear ALL saved entries?')) setEntries([]);
  };

  // Normalize the outgoing payload (fill missing manager UPN, ensure booleans)
  // so uploads stay consistent regardless of how data was entered.
  const buildPayload = (listManagers, items) => {
    return items.map(entry => {
      const { managerName, ...rest } = entry;

      if (!rest.managerUpn && rest.managerId) {
        const manager = listManagers.find(m => m.id === rest.managerId);
        if (manager?.upn) rest.managerUpn = manager.upn;
      }

      if (typeof rest.fullTime !== 'boolean') rest.fullTime = true;

      rest.startDate = formatStartDate(rest.startDate || defaultStartDate());
      return rest;
    });
  };

  // Allow downloading the current cache as a timestamped JSON file for offline
  // sharing or debugging.
  const exportJSON = () => {
    const payload = buildPayload(lists.managers, entries);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');

    anchor.href = URL.createObjectURL(blob);
    anchor.download = `employees-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  // Submit all saved entries to the API, prune accepted ones locally, and
  // surface a toast summarizing the result.
  const submitAll = async () => {
    const toSubmit = entries;
    if (!toSubmit.length) {
      showToast('Nothing to submit.');
      return;
    }

    const payloadEntries = buildPayload(lists.managers, toSubmit);

    const response = await fetch(API.submitAll, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: payloadEntries }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast('Submit failed.');
      return;
    }

    const acceptedIds = new Set((result.accepted || []).map(x => x.id));
    const failed = result.failed || [];

    setEntries(previous => previous.filter(entry => !acceptedIds.has(entry.id)));

    const ok = acceptedIds.size;
    const fail = failed.length;
    showToast(fail ? `Submitted ${ok}, ${fail} failed.` : `Submitted ${ok} and cleared.`);
  };

  return (
    <>
      <UserBadge />

      <main>
        <section className="card" aria-labelledby="form-title">
          <h1 id="form-title">New Employee Input Form</h1>
          <p className="muted">All fields required.</p>

          <form onSubmit={saveEntry} onReset={resetForm} noValidate>
            <div className="row">
              <div className="field half">
                <label htmlFor="firstName">
                  First name <span className="muted">• required</span>
                </label>
                <input
                  id="firstName"
                  value={form.firstName}
                  onChange={event => setField('firstName', event.target.value)}
                  className={errors.firstName ? 'error' : ''}
                />
                <div className="err">{errors.firstName || ''}</div>
              </div>

              <div className="field half">
                <label htmlFor="lastName">
                  Last name <span className="muted">• required</span>
                </label>
                <input
                  id="lastName"
                  value={form.lastName}
                  onChange={event => setField('lastName', event.target.value)}
                  className={errors.lastName ? 'error' : ''}
                />
                <div className="err">{errors.lastName || ''}</div>
              </div>

              <div className="field half">
                <label htmlFor="title">
                  Title <span className="muted">• required</span>
                </label>
                <input
                  id="title"
                  value={form.title}
                  onChange={event => setField('title', event.target.value)}
                  className={errors.title ? 'error' : ''}
                />
                <div className="err">{errors.title || ''}</div>
              </div>

              <div className="field half">
                <label htmlFor="department">
                  Department <span className="muted">• required</span>
                </label>
                <select
                  id="department"
                  value={form.department}
                  onChange={event => setField('department', event.target.value)}
                  className={errors.department ? 'error' : ''}
                >
                  <option value="">Select…</option>
                  {lists.departments.map(department => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
                <div className="err">{errors.department || ''}</div>
              </div>

              <div className="field half">
                <label htmlFor="businessUnit">
                  Business Unit <span className="muted">• required</span>
                </label>
                <select
                  id="businessUnit"
                  value={form.businessUnit}
                  onChange={event => setField('businessUnit', event.target.value)}
                  className={errors.businessUnit ? 'error' : ''}
                >
                  <option value="">Select…</option>
                  {lists.businessUnits.map(businessUnit => (
                    <option key={businessUnit} value={businessUnit}>
                      {businessUnit}
                    </option>
                  ))}
                </select>
                <div className="err">{errors.businessUnit || ''}</div>
              </div>

              <div className="field half">
                <label htmlFor="startDate">
                  Start Date <span className="muted">• required</span>
                </label>
                <input
                  id="startDate"
                  type="date"
                  value={form.startDate}
                  onChange={event => setField('startDate', event.target.value)}
                  className={errors.startDate ? 'error' : ''}
                  aria-describedby="startDate-err"
                />
                <div id="startDate-err" className="err" aria-live="polite">
                  {errors.startDate || ''}
                </div>
              </div>

              <div className="field half">
                <label htmlFor="fullTime">Full time</label>
                <input
                  id="fullTime"
                  type="checkbox"
                  checked={form.fullTime}
                  onChange={event => setField('fullTime', event.target.checked)}
                  aria-describedby="fullTime-help"
                />
                <div id="fullTime-help" className="err" aria-live="polite"></div>
              </div>

              <ManagerComboBox
                managers={lists.managers}
                value={form.managerId ? { id: form.managerId, name: form.managerName } : null}
                onSelect={manager =>
                  manager
                    ? setForm(previous => ({
                        ...previous,
                        managerId: manager.id,
                        managerUpn: manager.upn || '',
                        managerName: manager.name,
                      }))
                    : setForm(previous => ({
                        ...previous,
                        managerId: '',
                        managerUpn: '',
                        managerName: '',
                      }))
                }
                error={errors.manager}
              />
            </div>

            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="primary" type="submit" disabled={!lists.managers.length}>
                Save Entry
              </button>
              <button className="ghost" type="reset">
                Reset
              </button>
              <button type="button" onClick={exportJSON}>
                Export JSON
              </button>
            </div>

            <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">
              {toast || ''}
            </div>
          </form>
        </section>

        <aside className="card" aria-labelledby="preview-title">
          <h2 id="preview-title">Live Preview (JSON)</h2>
          <pre className="kvs" style={{ whiteSpace: 'pre-wrap' }} aria-live="polite">
            {JSON.stringify(buildPayload(lists.managers, [form])[0], null, 2)}
          </pre>
        </aside>

        <section className="card" style={{ gridColumn: '1 / -1' }} aria-labelledby="entries-title">
          <div className="toolbar">
            <h2 id="entries-title" style={{ margin: 0 }}>
              Saved Entries
            </h2>
            <span className="muted" id="entries-count">
              {entries.length ? `(${entries.length})` : ''}
            </span>
            <span style={{ flex: 1 }} />
            <HealthBadge />
            <button
              type="button"
              className="primary"
              onClick={submitAll}
              disabled={!entries.length || !unsubmitted}
            >
              Submit All{unsubmitted ? ` (${unsubmitted})` : ''}
            </button>
            <button type="button" className="ghost" onClick={clearAll}>
              Clear All
            </button>
          </div>

          <EntriesTable
            entries={entries}
            onEdit={editEntry}
            onDelete={id => setEntries(previous => previous.filter(x => x.id !== id))}
          />
        </section>
      </main>
    </>
  );
}
