# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in LegacyBot, please report it responsibly.

**Please do not open a public GitHub issue for security vulnerabilities.**

Preferred: use GitHub's private vulnerability reporting — the **"Report a vulnerability"** button under this repository's **Security** tab. It opens a private channel visible only to the maintainer.

Alternatively, email **andrew.brook@fooblah.org**.

Include as much detail as you can:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations

We will acknowledge your report within 48 hours and aim to release a fix within 14 days for critical issues.

## Scope

This policy covers the LegacyBot web application and its Firebase Cloud Functions backend.

## Known Limitations

- Family creation is gated: direct client creation is blocked by Firestore rules, and new families can only be created through the `redeemInvitationCode` Cloud Function using a superadmin-issued invitation code. Codes are multi-use, so a leaked active code could be redeemed by multiple accounts until a superadmin deactivates it.
- Cloud Storage access is gated on Firebase Auth custom claims (`familyIds`). Claims are set by the `onMemberWritten` Cloud Function and may have a brief propagation delay after joining a family.
