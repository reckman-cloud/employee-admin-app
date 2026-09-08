import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import UserBadge from '../security/UserBadge.jsx';

export default function Devices() {
  const [serialNumber, setSerialNumber] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
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
              />
            </div>
            <div className="toolbar" style={{ marginTop: 14 }}>
              <button className="primary" type="submit">Search</button>
              <Link to="/">Back to home</Link>
            </div>
          </form>
        </section>
      </main>
    </>
  );
}
