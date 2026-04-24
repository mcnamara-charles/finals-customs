# Worktree Rules

Simple A/B UI exploration should not use extra worktrees; use the ui-variants workflow in the main checkout (or a regular feature branch) unless the router flags a broad, high-risk change.

When a task is classified as complex and worktree_recommended is yes:
- perform the task inside a dedicated git worktree
- one task = one branch = one worktree
- do not modify the main checkout
- do not modify sibling worktrees
- keep all edits isolated to the active worktree
- report the worktree path and branch name before implementation

Suggested convention:
- main repo remains the stable/default checkout
- worktrees live under .trees/
- branch and worktree names should match the task slug