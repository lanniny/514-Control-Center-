# Ultracode Approval Gates

Ask one clear approval question before risky work. If approval is absent, continue only with safe read-only work, local drafts, or non-destructive checks.

## Approval Required

- Delete files or directories, overwrite user work, mass rename.
- Force push, reset history, rewrite shared branches, alter remotes.
- Publish, deploy, email, post, or call an external system with side effects.
- Run migrations or broad codemods.
- Touch credentials, secrets, production data, billing, or user accounts.
- Start expensive or long-running agent swarms.
- Install packages globally or change machine-level configuration.
- Use real customer data in prompts or generated artifacts.

## Usually Safe Without Approval

- Read local files.
- Inspect status, diffs, or logs.
- Run targeted tests or linters that do not mutate source.
- Create local drafts under the workflow run root.
- Create packet plans and result notes.
- Run local validation commands.

## Ambiguous Risk Process

1. State the action.
2. State the possible side effect.
3. Offer a safe fallback.
4. Ask one yes/no question.

Do not ask for approval when the user already approved the exact action in the current turn, when the action is read-only/local, or when a safe next step can progress the task.
