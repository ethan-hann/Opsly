# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Opsly, I encourage you to report it as
soon as possible. Your efforts to responsibly disclose security issues are
appreciated and help keep Opsly — and everyone self-hosting it — safe.

**Please do not report vulnerabilities through public GitHub issues, discussions,
or pull requests.**

Please follow these steps:

1. **Report using GitHub Security Advisories**:
   - [Report a vulnerability](https://github.com/ethan-hann/Opsly/security/advisories/new)
   - GitHub Advisories does not send me a notification, so please **also** send me a
     short email:
     - **Email**: [security@tortal.tech](mailto:security@tortal.tech)
     - **GPG Key**: [Public Key](https://drive.tortal.tech/wl/?id=g00xy9XxTUDGnXN3OHSbzO3z8ztl7hbM&fmode=download)
     - **Include only the title** of your advisory in the email. Do **not** include
       any details in the email — I will find the full report on GitHub.

2. **What to include** (in the advisory itself, not the email):
   - The type of issue (e.g. cross-org data access, authentication bypass,
     injection, secret exposure).
   - The affected component (`artifacts/api-server`, `artifacts/it-task-manager`,
     `lib/*`) and the relevant file paths or endpoints.
   - Steps to reproduce or a proof-of-concept, plus the impact and any suggested fix.

3. **What to Expect**:
   - **Acknowledgment**: I will acknowledge receipt of your report within 48 hours.
   - **Discussion**: We will discuss the potential vulnerability and, if needed,
     collaborate on a fix using a private fork.
   - **Resolution**: If the vulnerability is accepted, you will be credited for your
     discovery.
   - **Decline**: If the issue is not accepted as a vulnerability, I will provide a
     detailed explanation as to why.

4. **Confidentiality**:
   - Please do not publicly disclose the vulnerability until I have addressed it. I
     aim to work with you to ensure the issue is resolved in a secure manner.

## Supported Versions

Opsly is under active development. Security fixes are applied to the `main` branch and
the latest release. If you self-host, track `main` or the most recent tagged release.

<!-- Once tagged releases exist, replace this with a version table, e.g.:
| Version | Supported |
|---------|-----------|
| 0.x     | ✅        |
-->

## Scope

In scope: the code in this repository. Out of scope: vulnerabilities in third-party
dependencies (report those upstream), and issues that require physical access or an
already-compromised host. When in doubt, report it privately and I will triage.
