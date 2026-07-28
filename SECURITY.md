# Security Policy

## Supported versions

Opsly is under active development. Security fixes are applied to the `main`
branch and the latest release only. If you self-host, track `main` or the most
recent tagged release.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Report privately through GitHub's built-in
[private vulnerability reporting](https://github.com/ethan-hann/Opsly/security/advisories/new)
(Security → Advisories → "Report a vulnerability"). This keeps the report
confidential until a fix is available and lets us coordinate a disclosure with
you.

<!-- TODO(maintainer): if you prefer email intake, add a monitored address here,
     e.g. security@your-domain, and enable "Private vulnerability reporting" in
     the repository's Security settings so the link above works. -->

Please include, where possible:

- The type of issue (e.g. authentication bypass, cross-org data access,
  injection, secret exposure).
- The affected component (`artifacts/api-server`, `artifacts/it-task-manager`,
  `lib/*`) and file paths or endpoints.
- Steps to reproduce, proof-of-concept, or a minimal test case.
- The impact and any suggested remediation.

## What to expect

- We aim to acknowledge a report within a few business days.
- We'll keep you updated as we validate and work on a fix, and we'll credit you
  in the advisory unless you ask us not to.
- Please give us a reasonable window to release a fix before any public
  disclosure.

## Scope

In scope: the code in this repository. Out of scope: vulnerabilities in
third-party dependencies (report those upstream), and issues that require
physical access or a compromised host. When in doubt, report it privately and
we'll triage.
