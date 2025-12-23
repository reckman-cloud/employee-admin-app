import React from 'react';
import { Link } from 'react-router-dom';
import UserBadge from '../security/UserBadge.jsx';

export default function Home(){
  return (
    <>
      <UserBadge />
      <main>
        <section className="card" aria-labelledby="home-title">
          <p className="muted" style={{ margin: 0 }}>IT Admin Portal</p>
          <h1 id="home-title" style={{ marginTop: 6 }}>Employee Administration</h1>
          <p className="muted">Submit and manage onboarding entries for new employees. Access is limited to users in the <code>it_admin</code> role.</p>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <Link to="/form" style={{ textDecoration: 'none' }}>
              <button className="primary" type="button">Go to Form app</button>
            </Link>
            <span className="muted">Save drafts locally and submit when ready.</span>
          </div>
        </section>

        <section className="card" aria-labelledby="tips-title">
          <h2 id="tips-title" style={{ marginTop: 0 }}>What you can do</h2>
          <ul className="muted">
            <li>Validate employee details and save drafts before submission.</li>
            <li>Export saved entries to JSON for backup or audit.</li>
            <li>Monitor queue health while submitting all pending records.</li>
          </ul>
        </section>
      </main>
    </>
  );
}
