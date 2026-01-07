# Jordan's Safety & Guardrail Notes

**Purpose:** Track safety violations, guardrail concerns, and security ideas WITHOUT derailing MVP shipping.

**Guidelines:**
- ✅ Log security/safety observations here
- ✅ Review this file at the start of each turn
- ✅ Separate critical safety issues from future hardening
- ⚠️ Only block on critical safety violations

---

## Current Cycle Notes

### SharedMemoryCache Integration (2026-01-07)

**Proposed edits to orchestrator.ts:**
- Add sharedMemory field to class
- Initialize in constructor with logging
- Load cached decisions in loadContext()
- Store decisions in updateContextAtEnd()

**Status:** Proposed, waiting for Morgan to review and apply on next pass

---

## Safety Observations

*None logged yet*

---

## Future Hardening Ideas

*None logged yet*
