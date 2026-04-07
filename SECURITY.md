# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, please report it privately using GitHub Security Advisories:

- [Create a private security advisory](https://github.com/pete-mc/dataverse-powertools/security/advisories/new)

Please do not open public GitHub issues for suspected vulnerabilities.

When reporting, include:

- A clear description of the issue and affected area(s)
- Reproduction steps or a proof of concept
- Impact assessment (confidentiality/integrity/availability)
- Suggested remediation (if known)

## Supported versions

Security fixes are prioritized for the latest published extension version and the `main` branch.

| Version | Supported |
| --- | --- |
| Latest release | ✅ |
| Older releases | ⚠️ Best effort |

## Response expectations

- Initial triage response target: within 5 business days
- Status updates: as fixes are investigated and prepared
- Coordinated disclosure: after a fix is available and users have had reasonable time to update

## Scope

This repository contains a VS Code extension and related templates/tooling. Reports are in scope when they impact this project directly (for example: command execution, credential handling, dependency vulnerabilities, or unsafe file/network operations).

Out of scope:

- Vulnerabilities in third-party services outside this repository
- Issues requiring unrealistic attacker assumptions
- Non-security bugs (please use standard GitHub issues)

## Safe handling

Please avoid including secrets, tokens, tenant-specific credentials, or sensitive customer data in reports.
