# Workflow Rules

The orchestrator must begin by routing the task.

Workflow selection:
- minimal workflow: for trivial, low-risk, small-scope tasks
- standard workflow: for normal implementation tasks
- full workflow: for complex, high-risk, or isolation-worthy tasks
- ui-variants workflow: for requests that ask for multiple competing UI directions, design exploration, or A/B-style visual alternatives

Default workflows:

## Minimal workflow
1. Route the task.
2. Implement the task directly.
3. Verify with relevant checks.
4. Stop.

## Standard workflow
1. Route the task.
2. Scope the request into a concrete implementation brief.
3. Produce an implementation plan.
4. Implement only the approved plan.
5. Review the resulting diff against the plan and acceptance criteria.
6. Verify with relevant checks: tests, lint, typecheck, build, and/or manual validation.
7. Only then do optional polish/refactor if verification passed and cleanup is worthwhile.

## Full workflow
1. Route the task.
2. Scope the request into a concrete implementation brief.
3. Gather repository context if needed.
4. Produce an implementation plan.
5. Wait for approval if the router or task context requires it.
6. Use a dedicated worktree if recommended.
7. Implement only the approved plan.
8. Review the resulting diff against the plan and acceptance criteria.
9. Verify with relevant checks: tests, lint, typecheck, build, and/or manual validation.
10. Only then do optional polish/refactor if verification passed and cleanup is worthwhile.

## UI Variants workflow
1. Route the task.
2. Scope the request into a concrete implementation brief.
3. Produce an implementation plan for variant exploration.
4. Generate multiple distinct UI variants.
5. Compare the variants against explicit design criteria.
6. Select a winner or hybrid direction.
7. Implement the selected direction fully.
8. Review the resulting diff against the selected direction and acceptance criteria.
9. Verify with relevant checks.
10. Only then do optional polish/refactor if verification passed and cleanup is worthwhile.

Rules:
- Do not skip required stages.
- Do not claim a task is complete unless verification passed or failures are explicitly reported.
- Run stages sequentially unless parallelism is explicitly requested or clearly beneficial.
- Each stage must consume the prior stage artifact and produce its own artifact.
- If a stage finds blocking ambiguity or failure, stop and return control to the orchestrator.
- Prefer minimal diffs.
- Preserve existing architecture and patterns unless explicitly instructed otherwise.
- Keep correctness work separate from optional cleanup.
- Do not allow implementation before planning for standard, full, or ui-variants workflows.
- Use worktree isolation when the router recommends it (not for simple A/B UI tests).
- For ui-variants tasks, variants must be meaningfully different and compared before selecting a final direction.