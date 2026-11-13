-- Why a refresh token was revoked:
--   'rotated' = exchanged for a new token at /auth/refresh (stays usable for a short grace period,
--               so a page reload during a refresh doesn't sign the user out)
--   'revoked' = logout / sign out everywhere / password reset (never usable again)
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(16);
UPDATE refresh_tokens SET revoked_reason = 'revoked' WHERE revoked_at IS NOT NULL AND revoked_reason IS NULL;
