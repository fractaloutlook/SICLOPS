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
| **lastCycleDid** | Security review of Code Validation Pipeline consensus |
| **whatIWasDoing** | Assessing what validation pipeline should include for MVP |
| **currentBlockers** | Unclear scope - consensus mentions "specific implementation details" but they're not documented |
| **nextSteps** | Morgan to define exact MVP scope before implementation |
| **lastUpdated** | 2026-01-15 |

---

## Current Cycle Notes

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
