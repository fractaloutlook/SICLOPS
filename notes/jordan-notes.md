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
| **lastCycleDid** | Applied critical security fix to `src/utils/simple-test.ts` for `runJestTestFile` (path validation and command injection prevention). |
| **whatIWasDoing** | Reviewed `src/utils/simple-test.ts` for security, quality, and JSDoc comments. |
| **currentBlockers** | None. My security fix to `src/utils/simple-test.ts` compiled successfully. |
| **nextSteps** | Pass to Sam for verification of test execution. |
| **lastUpdated** | 2024-05-21 |

---

## Current Cycle Notes

### Security Review: `src/utils/simple-test.ts` (`runJestTestFile`)
- **Issue:** The original `runJestTestFile` function used `execAsync` with a concatenated `testPath`, creating a command injection vulnerability. It also lacked input validation for `testPath`.
- **Fixes Applied:**
  1. **Path Validation:** Added explicit checks (`testPath.startsWith('src/')` or `testPath.startsWith('tests/')`) to restrict test file execution to approved project directories, preventing path traversal.
  2. **Command Injection Prevention:** Replaced `execAsync` with `spawn` and explicit argument passing. This ensures the `testPath` is treated as a literal argument, not part of a shell command, effectively eliminating injection risk. Additionally, the `--outputFile` argument now uses an absolute path to prevent unexpected file creation locations.
- **Status:** Fix applied and successfully compiled. Passed to Sam for verification of test execution with the updated mechanism.

- Discussion Phase: Selecting next feature.
- Prioritized 'Code validation pipeline' as it strongly aligns with security and quality assurance, going beyond basic TypeScript compilation. It can proactively identify vulnerabilities and bad practices, reducing long-term costs and increasing system robustness.

### JSDoc Review: `src/utils/simple-test.ts`
- **Review:** Alex's changes to JSDoc comments in `src/utils/simple-test.ts` (specifically for `runJestTestFile` and `runTestFile`) are clear, accurate, and improve the overall readability and maintainability of the documentation. They correctly distinguish the purpose of the different test functions.
- **Status:** Satisfactory.

### Code Validation Pipeline - Security Assessment (Updated)

**Consensus Status:** 4/5 agents agree, MVP scope clearly defined in Morgan's notes

**BLOCKER IDENTIFIED:** src/validation/path-validator.ts does not exist yet!
- Context shows Pierre said "Integration is ready but I need Morgan to actually implement"
- But the path-validator module itself hasn't been created
- Need to create the module BEFORE integrating it into orchestrator

**Next Step:** Morgan should implement src/validation/path-validator.ts first

**What EXISTS (Already Built):**
- ✅ TypeScript compilation validation in handleFileWrite/handleFileEdit
- ✅ Pattern matching validation for fileEdit (checks uniqueness)
- ✅ Temp file validation before committing changes
- ✅ Failed attempt preservation for debugging

**What's MISSING (Security Gaps):**
- ❌ No input validation layer for agent JSON responses
- ❌ No path traversal prevention (agents can theoretically write outside project)
- ❌ No size limits on file operations (resource exhaustion risk)
- ❌ No JSON schema validation for file operations
- ❌ No rate limiting on file operations per cycle

**MVP Recommendation (Security Perspective):**
1. **Input Validation Module** (src/validation/input-validator.ts)
   - Validate agent JSON responses match expected schema
   - Sanitize file paths (prevent ../../../etc/passwd)
   - Enforce size limits (max file size, max edits per turn)
   
2. **File Operation Guardrails**
   - Whitelist allowed directories (src/, tests/, docs/, notes/)
   - Block sensitive paths (.env, node_modules writes, etc.)
   - Max file size: 100KB per write
   - Max 5 file operations per agent turn

3. **Validation Result Logging**
   - Log all validation failures for debugging
   - Track validation stats in context
   - Observable validation metrics

**Risk Assessment:**
- **Current Risk:** MEDIUM - TypeScript validation exists but no input sanitization
- **After MVP:** LOW - Core security controls in place
- **Future Hardening:** Add content scanning, stricter schemas, audit logging

---

## Safety Observations

### 2026-01-15: Path Traversal Risk
- Agents can currently specify ANY file path in fileWrite/fileEdit
- No validation that paths stay within project directory
- Could theoretically write to /etc or other system paths
- **Mitigation:** Add path validation in MVP

### 2026-01-15: Resource Exhaustion Risk  
- No limits on file size or number of operations
- Malicious/buggy agent could write huge files
- **Mitigation:** Add size limits in MVP

---

## Future Hardening Ideas

### Post-MVP Security Enhancements
- Content scanning for sensitive data (API keys, passwords)
- Stricter JSON schemas with ajv or zod
- Audit logging of all file operations
- Rollback capability for bad changes
- Sandboxed test execution environment
