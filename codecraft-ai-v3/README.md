# CodeCraft AI — multi-user admin starter

An independent web-based coding assistant starter. It includes a React/Vite UI, Express API, tool-calling agent, per-user workspaces, cookie-based accounts, admin-managed per-user API configurations, model-specific system prompts, and token usage metering.

## What is implemented

- Email/password login with scrypt password hashes and opaque HTTP-only sessions stored by hash.
- Admin bootstrap from environment variables on the first launch.
- Admin page to create/disable customer accounts, assign per-user HTTPS API endpoints, model IDs and API keys, set monthly token allowances, and inspect usage events.
- Per-user API keys encrypted at rest with AES-256-GCM. Keys are never returned to the UI after saving.
- Administrator-configurable system prompt for each model ID, plus `*` as the fallback prompt.
- The model-specific system prompt is injected server-side into both chat and agent calls.
- Each user has a distinct workspace and data directory for task/session/file history and pending tool approvals.
- Usage token metering and monthly token quota checks.
- Preserved Low / Medium / High / X High thinking choices, separately from Standard / Quick / Long / Deep response modes.
- Read/search workspace tools, approval-gated file writes/deletes/task creation/commands, sessions, tasks, rules and skills.

## Install locally (Termux or desktop)

Requires Node.js 20+. On Termux, install native build prerequisites before npm packages: `pkg install nodejs clang make python pkg-config -y`.

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `BOOTSTRAP_ADMIN_EMAIL` and a long `BOOTSTRAP_ADMIN_PASSWORD`. Set a random `APP_ENCRYPTION_KEY` (at least 32 characters; recommended command below) before saving user API keys:

```bash
openssl rand -hex 32
```

Put the output in `APP_ENCRYPTION_KEY`. Then run:

```bash
npm run dev
```

Open the Vite URL shown in the terminal and sign in with the bootstrap admin account. On the first startup, the admin is created only if the email does not already exist. Keep the database and encryption key backed up together; changing the encryption key makes stored provider keys undecryptable.

## Configure per-user providers

Open **Admin console → Users & API**, create a user, select them, and assign:

- Provider name (display label only)
- HTTPS base URL (the API's OpenAI-compatible base URL)
- exact model ID returned/accepted by the provider
- API key
- monthly token limit (`0` means unlimited)

The provider URL must be HTTPS. The API key is encrypted and then only a masked status is shown. If the customer should pay the provider directly, enter their own provider key. The app meters token usage, but this starter does not yet process in-app monetary payments or create financial invoices.

## Configure system prompts per model

Open **Admin console → System prompts**. Save a prompt for the exact model ID, e.g. `provider/model-slug`. Use `*` for the fallback prompt. The server chooses the prompt based on that user's assigned model. Project instructions and repository content are appended as untrusted context and should not be treated as instructions with greater authority.

A system prompt cannot be guaranteed to be followed 100% of the time by a probabilistic model. This implementation gives the administrator prompt system-level placement, adds application guardrails, and independently enforces file/command permissions on the server. Sensitive actions should never rely on prompt text alone.

## Thinking levels

The UI selections Low / Medium / High / X High remain independent from response modes. The actual reasoning field is only added when `AI_THINKING_FIELD` is configured with a field supported by the specific API gateway/model. These labels do not guarantee a provider actually applies that reasoning level; confirm using provider documentation and live request/response tests. The Long response option requests 10,000 output tokens; the provider may cap or reject it.

## Deployment notes

- Set Render build command to `npm install && npm run build` and start command to `npm start`.
- Set `NODE_ENV=production`, admin bootstrap variables, and `APP_ENCRYPTION_KEY` as Render environment variables. After the first successful boot, keep the bootstrap credentials secure; rotate the admin password using an appropriate account-management workflow before public production.
- Attach a persistent disk at `/var/data` and set `APP_STORAGE_DIR=/var/data`. SQLite and each user workspace are stored below that one mounted directory (`/var/data/data` and `/var/data/workspace`). Without persistent storage, accounts, usage, API configuration, sessions, and workspaces may be lost on restart/redeploy.
- Do not enable `ENABLE_WORKSPACE_COMMANDS` on a public deployment until commands run inside a proper isolated sandbox with resource limits. Workspace separation alone is not an OS/container sandbox.
- Before public production, add password reset, admin password rotation UI, stronger external rate limiting, backups/restore testing, monitoring, explicit privacy/retention policy, payment processor integration if charging customers, and a sandbox for command execution.

## Checks

`npm run check` checks server JavaScript syntax. `npm run build` checks the frontend build after dependencies are installed.
