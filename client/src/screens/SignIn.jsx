import React from 'react';
export default function SignIn(){
  return (
    <div className="center card" aria-labelledby="signin-title">
      <h1 id="signin-title">IT Admin Sign-in</h1>
      <p className="muted">Use your work account to continue.</p>
      <p><a href="/login"><button className="primary">Sign in with Microsoft</button></a></p>
      <details style={{marginTop:12}}>
        <summary className="muted">Trouble signing in?</summary>
        <ul className="muted">
          <li>Access is limited to users assigned the <code>it-admin</code> role.</li>
          <li>Assign roles in Azure Static Web Apps → Role management.</li>
        </ul>
      </details>
    </div>
  );
}
