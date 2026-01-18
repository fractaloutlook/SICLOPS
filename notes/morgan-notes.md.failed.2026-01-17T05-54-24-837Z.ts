# Morgan's Implementation Notes

**Purpose:** Track implementation ideas, technical debt, and future improvements WITHOUT derailing current MVP work.

**Guidelines:**
- ✅ Log ideas here instead of immediately implementing them
- ✅ Review this file at the start of each turn
- ✅ Keep notes concise (bullet points preferred)
- ⚠️ Only implement MVP-critical changes in current cycle

---

## 🎯 Status Tracker (UPDATE EVERY TURN!)

| Field | Value |
|-------|-------|
| **lastCycleDid** | Attempted to fix compilation errors in `src/orchestrator.ts` to support the Code Validation Pipeline, but `fileEdit` patterns were incorrect. Also failed to update notes due to pattern mismatch. |
| **whatIWasDoing** | Advocating for the Code Validation Pipeline feature, and will fix `src/orchestrator.ts` compilation errors as a prerequisite. |
| **currentBlockers** | Accurate `fileEdit` patterns for `src/orchestrator.ts` compilation fixes. |
| **nextSteps** | Once consensus is reached, resolve `src/orchestrator.ts` compilation errors, then proceed with `path-validator.ts` implementation. |
| **lastUpdated** | 2025-01-01 (current cycle) |

---

## Current Cycle Notes

**Task:** Code Validation Pipeline - MVP SCOPE DEFINED

**Proposal (Code Validation Pipeline):**
- **Mechanism:** A dedicated `src/validation` directory will house validation utilities.
- **`path-validator.ts`:**
  - Initial focus on `fileEdit` and `fileWrite` operations.
  - Ensures file paths adhere to project structure and naming conventions.
  - Prevents writing/editing critical system files (e.g., orchestrator.ts, config.ts) without explicit override.
  - Validates `filePath` to prevent directory traversal attacks (e.g., `../../`).
  - Checks for valid file extensions.
- **Orchestrator Role:**
  - Integrates `path-validator` before executing any file operation.
  - Rejects invalid file operations and returns an error to the offending agent.
- **Enforcement:** Hard block on invalid file operations, providing immediate feedback to the agent.

**Code Validation Pipeline - MVP Definitions:**
- **Valid Path (MVP):** A file path is considered valid if it:
  - Does not contain `..` for directory traversal.
  - Does not attempt to write/edit outside of allowed directories (e.g., `src/`, `notes/`, `docs/`, `tests/`, `data/`).
  - Uses an allowed file extension (e.g., `.ts`, `.md`, `.json`, `.js`).
- **Critical System Files (MVP):** `src/orchestrator.ts`, `src/config.ts` are initially considered critical and require explicit handling or a separate permission system (out of scope for MVP). For now, `path-validator` will disallow direct edits to these, returning a specific error.
- **Expected Behavior After Rejection (MVP):** Upon an operation being rejected by the `path-validator`, the offending agent should receive a clear error message from the Orchestrator detailing the validation failure. The agent should then `self-pass` to adjust their proposed changes based on the validation feedback.

**MVP SCOPE (what we're building NOW):**
- Create `src/validation/path-validator.ts` with initial validation logic.
- Integrate `path-validator` into `src/orchestrator.ts` to intercept `fileEdit` and `fileWrite` operations.
- Orchestrator returns specific validation error messages to agents.

**Out of Scope (future work):**
- Content scanning for secrets
- JSON schema validation with ajv/zod
- Pre-commit hooks
- Audit logging
- Rollback capability

---

## Future Improvements / Technical Debt

*None logged yet*

---

## Lessons Learned

*None logged yet*
