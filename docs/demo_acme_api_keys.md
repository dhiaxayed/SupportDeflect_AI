# Acme SaaS API key management

API keys are managed from the Acme SaaS admin console.

## Regenerate an API key

To regenerate an API key, open **Settings**, select **API Keys**, choose the key you want to rotate, then click **Regenerate**. Copy the new key immediately and update your integration before deleting the old key.

Regenerating a key invalidates the previous key after a short grace period. If you suspect a key was exposed, contact security support immediately.

## Troubleshooting

If an integration returns 401 Unauthorized after key rotation, verify that the new key was copied without extra spaces and that the environment variable was redeployed.
