# HealPoint Security Review

Read-only review of the authentication, HTTP configuration, CORS, token handling,
authorization, clinic isolation, and password/sensitive-data paths. No files or
database records were changed during the audit. Deployment-edge configuration
was not inspected.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟡 MEDIUM | `backend/controllers/doctorController.js` | 82-100, 600, 629, 644, 692 | A Clinic Admin can pass a clinic they manage to the doctor update authorization check; that check does not verify the doctor is associated with that clinic. The authorized request can change shared doctor-profile fields, affecting a doctor outside the admin's clinic. **Confirmed issue.** | 9/10 |
| 2 | 🟡 MEDIUM | `backend/routes/authRoutes.js` | 7-8 | Login and registration routes have no rate-limiting middleware in the inspected route configuration, increasing exposure to credential stuffing and automated account creation. **Control gap observed; hosting-level controls were not inspected.** | 8/10 |
| 3 | 🟡 MEDIUM | `backend/app.js` | 13-21 | No HTTP security-header or Content Security Policy middleware is configured in the inspected Express app. Browser hardening is therefore not established at this layer. **Control gap observed; proxy/hosting headers were not inspected.** | 8/10 |
| 4 | 🟡 MEDIUM | `frontend/src/App.jsx`; `backend/utils/generateToken.js` | `App.jsx`: 59, 172; `generateToken.js`: 4-11 | The frontend keeps the bearer JWT in `sessionStorage`; the token expires after seven days by default and has no server-side revocation shown. Same-origin script execution could read the token, and logout only removes the browser copy. No exploitable XSS was confirmed in this review. **Risk/control gap, not a confirmed exploit.** | 8/10 |
| 5 | ⚪ LOW | `backend/utils/validateAuth.js` | 2, 17-20 | Password validation permits a minimum of six characters, which is weak by current standards. **Policy gap observed.** | 9/10 |

## Recommended fixes

1. In `doctorController.js`, require an existing association between the target
   doctor and a clinic managed by the caller before permitting shared profile
   changes. Keep clinic-specific schedule/assignment changes scoped to that
   clinic.
2. Add bounded login and registration rate limits, with additional account-aware
   throttling for repeated failed logins.
3. Configure security headers and a CSP appropriate to the app. If these are
   supplied by a reverse proxy or hosting platform, verify and document that
   configuration as well.
4. Reduce access-token lifetime and introduce refresh-token rotation/revocation,
   or move tokens to secure HttpOnly cookies with appropriate CSRF protections.
   Review the app for XSS as a separate task.
5. Strengthen the password policy and reject common or compromised passwords.

## Controls observed

- CORS is restricted to the configured client origin in `backend/app.js`
  (lines 14-18); no permissive wildcard was observed in the inspected
  configuration.
- Passwords use the User model's bcrypt hashing hook with cost 12, and the
  password field is excluded from normal queries (`backend/models/User.js`,
  lines 22-24 and 58).
- Authentication responses use the User safe-object representation. No
  password or hash exposure was identified in the inspected login and account
  creation responses.
- Public registration assigns the patient role server-side and rejects elevated
  role requests (`backend/controllers/authController.js`, lines 18-21 and 38-42).
- Other examined clinic-admin scopes derive access from the managed clinic set;
  the confirmed exception is the doctor update authorization described above.

This report is based on source inspection only. No penetration testing,
deployment configuration review, database access, or code changes were
performed.
