# Employee Admin App (React + Azure Functions + SWA Auth)

## Local dev
1) **Functions**
   ```bash
   cd api
   cp local.settings.example.json local.settings.json
   npm i
   func start
   ```

## Preview environment notes
Pull request preview environments do not automatically receive the production app settings that the managed backend depends on. The Functions app uses several environment variables (for example `AZURE_STORAGE_CONNECTION_STRING`, `AzureWebJobsStorage`, and group identifiers like `MANAGERS_GROUP_ID`) to authorize to Azure Storage and Microsoft Graph, as seen in the `/api/health` and `/api/groups-check` functions. When those secrets are missing in a staging slot, the health endpoint returns `503` (connection string is empty) and Graph lookups cannot acquire a token, so API calls from the preview front end fail even though the static site builds correctly. Ensure the required settings are supplied to any preview/static-web-app environment that needs to reach the managed backend.

If storage settings are present but the `/api/health` badge still shows an error, check authentication in the preview slot. The health endpoint requires callers with the `it_admin` role (or `ALLOW_ANON_HEALTH=true` in non-production) because it touches the queue. Previews that do not propagate principal headers will receive `403` even with valid connection strings; either sign in with an authorized role or set `ALLOW_ANON_HEALTH` for that slot.

The health probe no longer attempts to create the queue; it only checks that the configured queue exists and can be read. When using SAS connection strings in previews, ensure the token grants at least `r` permissions on the queue so the probe can retrieve properties instead of failing with `queue-connection-failed`.

## Device search configuration

The Devices page searches Microsoft Intune and Mosyle concurrently. The Intune function uses the same Azure client credential environment variables as the existing Microsoft Graph integration (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`), or the Function App's managed identity when those values are not set. That identity needs permission to read Intune managed devices.

Configure Mosyle with `MOSYLE_API_TOKEN`, `MOSYLE_API_EMAIL`, and `MOSYLE_API_PASSWORD`. The function first sends the API access token as the `accessToken` header and the email/password credentials to Mosyle's `/login` endpoint. It reads the bearer token from the login response's `Authorization` header, then sends both the original `accessToken` and `Authorization: Bearer <token>` headers when posting Mosyle's documented JSON `list` operation directly to `/devices` (with response-body token fields supported as a fallback). The lookup requests only documented device and user columns, including `serial_number`, `device_name`, `username`, `useremail`, and `userid`. `MOSYLE_API_URL` can override the default `https://businessapi.mosyle.com/v1` base URL.

To help diagnose preview slots, the `/api/health` response includes a masked snapshot of the storage configuration (queue name and connection-string length/preview) alongside the status. This makes it clear on the client whether environment variables were populated even when the connection cannot be established. When a connection attempt still fails, the response now returns a sanitized diagnostic payload (reason code, status code, redacted message, and parsed SAS/account metadata) and environment flags (for example, whether `crypto` was polyfilled for queue authentication) to help confirm permissions and endpoint selection without leaking secrets.
