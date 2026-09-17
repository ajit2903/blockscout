# Admin authentication

The admin panel uses GitHub OAuth and only grants access to explicitly
allowlisted GitHub user IDs.

## GitHub OAuth app

Create an OAuth app in GitHub under **Settings → Developer settings → OAuth
Apps**. Set:

- Homepage URL: the Vercel deployment URL
- Authorization callback URL:
  `https://<deployment-domain>/api/admin/callback`

Do not enable wildcard callback URLs.

## Vercel environment variables

Configure these variables for the Production environment and redeploy:

- `GITHUB_CLIENT_ID`: OAuth app client ID
- `GITHUB_CLIENT_SECRET`: OAuth app client secret
- `GITHUB_CALLBACK_URL`: exact callback URL configured in GitHub
- `GITHUB_ADMIN_IDS`: comma-separated numeric GitHub user IDs allowed to sign in
- `ADMIN_SESSION_SECRET`: random secret containing at least 32 bytes
- `ETHEREUM_RPC_URL`: Ethereum JSON-RPC endpoint

`ADMIN_COOKIE_SECURE=false` is available only for local HTTP development.

After sign-in, the dashboard displays the GitHub login and numeric ID from the
signed admin session. Only IDs in `GITHUB_ADMIN_IDS` receive access.

Allowlisted admins can supply a per-request target address when scanning
Blockscout blocks or filtering beacon-chain withdrawals. This does not persist
or change a validator's consensus-layer withdrawal credentials; `TARGET_ADDRESS`
remains the fallback when the form field is empty.

When `DISABLE_ADMIN_AUTH=true`, per-request target-address overrides are denied;
local development uses the trusted server-side `TARGET_ADDRESS` value instead.
