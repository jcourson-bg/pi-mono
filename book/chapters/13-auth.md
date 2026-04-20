# 13. Auth, credentials, and OAuth

Pi has to hold credentials for twenty-plus providers. Some are
static API keys; some are OAuth tokens with refresh flows; some
(Bedrock) are whole AWS credential chains. This chapter covers the
storage format, the refresh semantics, and the runtime override
escape hatch.

## The storage file

Everything lives in `~/.pi/auth.json`. A flat JSON object keyed by
provider id:

```json
{
  "anthropic":  { "type": "api_key", "key": "sk-ant-..." },
  "openai":     { "type": "api_key", "key": "sk-..." },
  "google":     { "type": "oauth", "accessToken": "...", "refreshToken": "...", "expires": 1745208000000 },
  "copilot":    { "type": "oauth", "accessToken": "...", "refreshToken": "...", "expires": ... },
  "bedrock":    { "type": "aws", "profile": "default", "region": "us-east-1" }
}
```

File permissions are explicitly chmodded to 0600
(`src/core/auth-storage.ts:57, 100`). Owner-only read and write.
That's the entire at-rest security model: **don't let other users on
the machine read your home directory.** There is no encryption at
rest; the author considered a passphrase-protected store and decided
it wasn't worth the UX cost.

## The `AuthStorage` abstraction

`src/core/auth-storage.ts` exposes two implementations:

- `FileAuthStorageBackend` — the normal one. Reads, writes, locks
  the file with `proper-lockfile`.
- `InMemoryAuthStorageBackend` — ephemeral. Used in tests and in
  `--no-session` mode where everything is supposed to disappear when
  the process ends.

Both implement `AuthStorageBackend` with `withLock()` and
`withLockAsync()` helpers so call sites don't have to remember to
release locks.

## OAuth: the supported providers

Five OAuth flows in pi-ai (`packages/ai/src/utils/oauth/index.ts:35-48`):

| provider | flow | token use |
|---|---|---|
| Anthropic | Claude Pro / Max OAuth | Converts to an API key equivalent for the session. |
| GitHub Copilot | Device flow | Bearer token against the Copilot chat API. |
| Google Gemini CLI | gcloud auth refresh | Uses the same tokens `gcloud` uses. |
| Google Antigravity | Google Cloud Code Assist OAuth | Enterprise flow. |
| OpenAI Codex | ChatGPT OAuth | Treats your ChatGPT login as an API key. |

For each, pi implements (a) an initial flow (browser → callback,
usually), (b) a refresh flow that exchanges a refresh token for a
new access token, and (c) a translation step that turns the access
token into whatever the provider actually wants on each HTTP call.

## The refresh loop

`getOAuthApiKey()` at `packages/ai/src/utils/oauth/index.ts:119-162`:

```ts
export async function getOAuthApiKey(
  providerId: OAuthProviderId,
  credentials: Record<string, OAuthCredentials>,
): Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null> {
  let creds = credentials[providerId];
  if (!creds) return null;

  if (Date.now() >= creds.expires) {
    creds = await provider.refreshToken(creds);
  }

  return { newCredentials: creds, apiKey: provider.getApiKey(creds) };
}
```

The contract is: the caller passes in the current credentials, and
the function returns potentially-new credentials and the usable
`apiKey` for now. **If new credentials came back, the caller must
persist them.** This is not enforced — it's a property of the API that
the coding agent has to honor.

The coding agent honors it through `AuthStorage.refreshIfNeeded()`,
which calls `getOAuthApiKey()` and immediately writes the new
credentials back to `auth.json` under lock.

## Runtime overrides

`main.ts:566-575`: the `--api-key` CLI flag sets a session-only
override. It takes precedence over whatever is in `auth.json`. It
does not get persisted. Usage:

```sh
pi --api-key sk-... "fix the readme"
```

This is useful for CI pipelines where the API key is in an env var,
or for quickly trying a different key without contaminating the
stored one.

There's also an env-var scanning layer in pi-ai
(`packages/ai/src/env-api-keys.ts`) that looks for provider-specific
env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`,
etc.) and treats them as implicit overrides. Priority order:

1. Explicit `--api-key` flag.
2. Provider-specific env var.
3. Stored credentials in `auth.json`.

Nothing found → pi prompts for the key interactively (when TTY), or
errors out (when not).

## The login subcommand

`pi login [provider]` opens whichever flow the provider supports. For
OAuth providers this launches a browser window to the authorization
URL and starts a local callback server. For API-key providers it
prompts for the key on the command line.

The stored credentials are what future `pi` invocations use. `pi logout
[provider]` removes them.

## Per-provider env auto-detection

`pi-ai` also includes a credential auto-detection layer for Bedrock
that inspects `AWS_PROFILE`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, etc.
in that order, building up a credential chain via the AWS SDK's
default chain. You don't explicitly "log in" to Bedrock with pi; you
set up your AWS creds normally and pi finds them.

## What pi does not do

- **No keyring integration.** On macOS you can store credentials in
  the system Keychain, on Linux in the Secret Service, on Windows in
  Credential Manager. Pi doesn't. It's plaintext on disk. The
  tradeoff is "works everywhere the same way," and the
  counter-mitigation is file permissions.

- **No per-project scoping.** `auth.json` is always global. You
  can't have "this project uses this Anthropic key, the other
  project uses that one." The workaround is env vars, which scope
  naturally to whatever process you launch.

- **No expiring tokens for API keys.** API keys are assumed
  static. Provider-side rotation (rotate an Anthropic key every 90
  days) requires you to `pi login anthropic` again.

## In one paragraph

Credentials live in `~/.pi/auth.json`, chmod 600, locked with
`proper-lockfile` for concurrent `pi` instances, and split by
provider with a discriminated-union type covering API keys, OAuth
tokens, and AWS profiles. OAuth refreshes are driven by a
caller-persist contract: the refresh function returns new creds,
and the caller writes them back. Runtime overrides via `--api-key`
and env vars sit in front of the stored values with a defined
priority.

Next chapter pulls the modes apart: interactive, print, and RPC.
