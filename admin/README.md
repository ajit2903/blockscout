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
