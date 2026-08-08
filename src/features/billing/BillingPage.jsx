import React from 'react';
import BillingSection from '../hosting-management/BillingSection.jsx';
import SandboxBanner from '../sandbox/SandboxBanner.jsx';

export default function BillingPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Billing</div>
          <h1>Account Billing</h1>
          <p className="sub">
            Combined billing for hosting, VPS services, domains, business email, and workspace services.
          </p>
        </div>
      </div>

      <SandboxBanner service="billing" />

      <BillingSection
        scope="workspace"
        app={{}}
      />
    </>
  );
}
