# Jordan's Safety & Guardrail Notes

**Purpose:** Track safety violations, guardrail concerns, and security ideas WITHOUT derailing MVP shipping.

**Guidelines:**
- ✅ Log security/safety observations here
- ✅ Review this file at the start of each turn
- ✅ Separate critical safety issues from future hardening
- ⚠️ Only block on critical safety violations

---

## 🎯 Status Tracker (UPDATE EVERY TURN!)

| Field | Value |
|-------|-------|
| **lastCycleDid** | Reviewed Morgan's proposed implementation areas for the 'Error Recovery System' (`fileEdit`, `fileWrite`, `runCommand`) and updated my notebook with specific security and quality considerations. |
| **whatIWasDoing** | Providing detailed security and quality feedback on Morgan's proposed implementation areas and preparing to pass to Sam for test planning. |
| **currentBlockers** | None. |
| **nextSteps** | Pass to Sam, the Test Engineer, to begin planning tests for the 'Error Recovery System', focusing on how to validate retry logic, backoff, and limits, especially for `fileEdit`, `fileWrite`, and `runCommand`. |
| **lastUpdated** | 2024-05-26 |

---

## Current Cycle Notes

### Error Recovery System Proposal Review
- **Overview:** Morgan and Sam propose implementing an 'Error Recovery System (retry with backoff)'.
- **Security & Quality Considerations:**
    - **Resource Exhaustion/DoS:** Must ensure retry mechanisms (e.g., backoff, max retries) are carefully designed and configurable to prevent infinite loops, resource consumption, or inadvertent DoS against external services.
    - **Information Leakage:** Error logging during retries should be controlled and sanitized to prevent sensitive data exposure.
    - **State Management:** Careful consideration needed for state cleanup/rollback on failed operations before retrying to prevent state corruption.
    - **Scope:** Define precisely which operations/errors are eligible for retry to avoid over-engineering or unintended behavior.
- **Benefits:** Directly aligns with goals for increased autonomy and graceful error recovery.    - **Status:** Agree with the proposal, with these security and quality considerations for implementation.

### Morgan's Implementation Area Proposal Review (fileEdit, fileWrite, runCommand)
- **Overview:** Morgan proposes integrating retry logic into `fileEdit`, `fileWrite`, and `runCommand`.
- **Security & Quality Considerations:**
    - **Resource Exhaustion/DoS:** For file operations and commands, rigorous limits (max retries, max backoff) are essential to prevent infinite loops, excessive I/O, or unintended DoS against external services. Backoff strategy must be robust.
    - **Information Leakage:** Ensure error logs generated during retries do not expose sensitive data from file contents or command arguments.
    - **State Management:** Consider idempotency for retried operations. If an operation partially succeeds or corrupts state before failing, a naive retry could worsen the problem. Needs careful design to prevent state corruption or unintended side effects.
    - **Scope:** The proposed scope focusing on `fileEdit`, `fileWrite`, and `runCommand` is appropriate for an MVP, targeting critical operations.

### Agent Handoff Protocol Review (`src/orchestrator.ts`)
- **Overview:** Reviewed Morgan's implementation of the 'Agent Handoff Protocol'.
- **Security & Best Practices:** The `isValidAgentName` method correctly validates `targetAgent` against `AGENT_WORKFLOW_ORDER` and 'Orchestrator', preventing misdelegation and enhancing system security. Error handling for invalid target agents is present, logging warnings and falling back to sequential workflow. The use of `path.normalize` and `PathValidator.validatePath` generally reinforces path safety.
- **Architectural Soundness:** The integration of the validation logic within `runCycles` for both consensus and sequential modes is appropriate, ensuring that delegation is always controlled. The design aligns with secure delegation principles.
- **Vulnerabilities:** No immediate vulnerabilities or bad practices were identified in the `Agent Handoff Protocol` implementation.
- **Code Style:** The new code adheres to established TypeScript and ESLint standards.
- **Status:** Approved from a security and quality perspective. No immediate vulnerabilities were identified. The implementation is robust and follows best practices.



## Safety Observations

### Path Traversal Risk (Mitigated)
- **Previous Risk:** Agents could specify arbitrary file paths in fileWrite/fileEdit.
- **Current Status:** Mitigated. `PathValidator.validatePath` is now integrated into `handleFileWrite`, `handleFileEdit`, `handleFileRead`, `handleLineRead`, and `handleFileGrep`. This prevents operations outside the project root and against sensitive files/directories.

### Resource Exhaustion Risk (Partially Mitigated)
- **Previous Risk:** No limits on file size or number of operations could lead to resource exhaustion.
- **Current Status:** Partially Mitigated. File operations now have implicit limits through buffer sizes (e.g., `execAsync` has `maxBuffer`) and explicit timeouts (e.g., `runCommand` timeout). However, explicit size limits on file content writes/edits, and rate limiting on file operations per turn, are still valuable future enhancements.

---

## Future Hardening Ideas

### Post-MVP Security Enhancements
- Content scanning for sensitive data (API keys, passwords)
- Stricter JSON schemas with ajv or zod
- Audit logging of all file operations
- Rollback capability for bad changes
- Sandboxed test execution environment
