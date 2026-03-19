<!--
================================================================================
SYNC IMPACT REPORT
================================================================================
Version: (new) 1.0.0
Previous: N/A (initial creation)

Modified principles: N/A
Added sections:
  - I. Code Quality
  - II. Testing
  - III. User Experience
  - IV. Performance
  - Security Requirements
  - Development Workflow
  - Governance

Removed sections: N/A

Templates requiring updates:
  - .rainbow/templates/templates-for-commands/design-template.md
    OK - Ground-rules Check section references ground-rules file dynamically
  - .rainbow/templates/templates-for-commands/spec-template.md
    OK - No direct ground-rules reference
  - .rainbow/templates/templates-for-commands/tasks-template.md
    OK - No direct ground-rules reference

Follow-up TODOs: None
================================================================================
-->

# Coding Plan Gateway Ground-rules

## Core Principles

### I. Code Quality

Code MUST be readable, maintainable, and follow established patterns. Every line of code is read more often than written.

**Non-negotiable rules:**

- All code MUST follow the project's established linting and formatting standards
- Functions and components MUST have a single responsibility
- Naming MUST be descriptive and consistent throughout the codebase
- Complexity MUST be justified; simpler alternatives MUST be considered first
- Dead code, commented-out code, and unused dependencies MUST be removed
- Code MUST be self-documenting; comments reserved for "why" not "what"

**Rationale:** Readable code reduces onboarding time, minimizes bugs, and enables
sustainable long-term maintenance.

### II. Testing

Testing MUST be comprehensive, automated, and integrated into the development workflow. Tests are executable documentation of expected behavior.

**Non-negotiable rules:**

- All new features MUST include corresponding tests
- Bug fixes MUST include regression tests that fail before the fix
- Tests MUST be independent, isolated, and repeatable
- Test coverage MUST NOT decrease on any PR merge
- Integration tests MUST validate component interactions at boundaries
- Contract tests MUST validate API agreements between services
- Tests MUST run in CI/CD pipeline before any merge

**Rationale:** Tests catch regressions early, enable confident refactoring, and
document intended behavior.

### III. User Experience

Every feature MUST be designed with the end user in mind. User experience is not optional; it is a core deliverable.

**Non-negotiable rules:**

- Features MUST be accessible to users with disabilities (WCAG 2.1 AA minimum)
- Error messages MUST be clear, actionable, and user-friendly
- Response times MUST meet defined performance targets (see Principle IV)
- User interfaces MUST be consistent with established design patterns
- New features MUST include user-facing documentation
- Breaking changes MUST be communicated with migration paths

**Rationale:** User experience directly impacts adoption, satisfaction, and
support costs.

### IV. Performance

Performance MUST be measured, monitored, and maintained. Performance is a feature, not an afterthought.

**Non-negotiable rules:**

- All endpoints MUST respond within defined latency targets (p95 < 200ms)
- Resource utilization MUST stay within allocated limits
- Performance regressions MUST be detected in CI/CD before merge
- Database queries MUST use appropriate indexes; N+1 queries prohibited
- Large operations MUST implement pagination or streaming
- Performance metrics MUST be monitored in production with alerting
- Load testing MUST be performed before major releases

**Rationale:** Performance directly impacts user experience, operational costs,
and system reliability.

## Security Requirements

Security MUST be built in from the start. Security is everyone's responsibility.

**Non-negotiable rules:**

- All inputs MUST be validated and sanitized
- Authentication and authorization MUST be enforced at all entry points
- Secrets and credentials MUST NEVER be committed to source control
- Dependencies MUST be scanned for known vulnerabilities
- Security-sensitive operations MUST be logged with appropriate detail
- OWASP Top 10 vulnerabilities MUST be actively prevented

## Development Workflow

A consistent workflow MUST be followed to ensure quality and collaboration.

**Non-negotiable rules:**

- All changes MUST go through pull request review
- Pull requests MUST be small, focused, and include clear descriptions
- Code reviews MUST be completed within 48 hours
- All commits MUST follow conventional commit message format
- Branches MUST be deleted after merge
- Breaking changes MUST be documented in CHANGELOG

## Governance

Ground-rules supersede all other practices. Amendments require documentation,
approval, and a migration plan when applicable.

**Amendment procedure:**

1. Propose amendment via pull request to `memory/ground-rules.md`
2. Document rationale and impact on existing code
3. Obtain approval from at least two maintainers
4. Update version following semantic versioning rules
5. Communicate changes to all stakeholders

**Versioning policy:**

- **MAJOR**: Backward incompatible principle removals or redefinitions
- **MINOR**: New principles added or materially expanded guidance
- **PATCH**: Clarifications, wording, typo fixes

**Compliance:** All PRs MUST verify compliance with these ground-rules.
Complexity that violates principles MUST be justified in the Complexity Tracking
section of `design.md`.

**Version**: 1.0.0 | **Ratified**: 2026-03-19 | **Last Amended**: 2026-03-19