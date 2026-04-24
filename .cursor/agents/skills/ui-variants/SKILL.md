---
name: ui-variants
description: Generate, compare, and select multiple UI variants for a component or screen.
---

Use this skill when the user wants multiple design options for the same UI.

Workflow:
1. Clarify the target component or screen.
2. Identify fixed constraints:
   - must-keep functionality
   - existing design system constraints
   - responsive requirements
   - accessibility constraints
3. Define comparison criteria before implementation.
4. Generate 3 to 5 variants.
5. Prefer isolated worktrees for each variant if the changes are non-trivial.
6. Compare variants explicitly against the criteria.
7. Choose one winner or define a hybrid follow-up.

Rules:
- Variants should be meaningfully different, not tiny cosmetic edits.
- Keep the file scope tight.
- Preserve behavior unless behavior changes are explicitly requested.
- Prefer screenshots or visual inspection if available.
- Do not claim one is “best” without comparing against stated criteria.