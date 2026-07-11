# Connect to Dataverse

Two ways to authenticate, both fully supported by every command:

- **Service principal** — an Azure AD app registration's client id + secret, plus your tenant id. Best for shared projects and CI.
- **Interactive (OAuth)** — sign in with your own account in the browser. Nothing to register; tokens are cached securely across restarts.

Credentials live in **VS Code secret storage** — `dataverse-powertools.json` only keeps the non-secret connection base (URL, auth type), so it is safe to commit.

Use **Switch Dataverse Environment** to point the same project at another environment, and **Refresh Connection** if a token has gone stale.
