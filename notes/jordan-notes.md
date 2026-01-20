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
| **lastCycleDid** | Reviewed SharedMemoryCache test refactor by Morgan and Sam. |
| **whatIWasDoing** | Verified reliability and quality of SharedMemoryCache tests, focusing on fake timers implementation. |
| **currentBlockers** | None. |
| **nextSteps** | Pass to Alex for documentation and UX review of SharedMemoryCache test changes. |
| **lastUpdated** | 2024-05-26 |

---

## Current Cycle Notes

### SharedMemoryCache Test Refactor Review (`src/memory/__tests__/shared-cache.test.ts`)
- **Overview:** Reviewed Morgan and Sam's refactor of the SharedMemoryCache tests, specifically the implementation of Jest's fake timers.
- **Quality & Reliability:** Confirmed the correct global application of `jest.useFakeTimers()` in `beforeAll` and `jest.useRealTimers()` in `afterAll`. Verified appropriate usage of `jest.advanceTimersByTime` in time-sensitive tests to ensure deterministic behavior. This significantly improves test reliability and consistency.
- **Security Implications:** Reliable and well-tested foundational components like SharedMemoryCache are crucial for overall system stability and indirectly contribute to security by ensuring data integrity and correct eviction policies. No new security vulnerabilities were introduced by these changes.
- **Code Style:** Changes adhere to established code style guidelines.
- **Status:** Satisfactory. The test suite is more robust and accurate.



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
