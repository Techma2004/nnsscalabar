-- Run once on an existing database:
--   mysql -u <user> -p nnss_calabar < database/005_session_version.sql
-- The login route and auth middleware read users.session_version, but older
-- schema.sql files never created it, so sign-in failed on fresh installs.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'session_version'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN session_version INT NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
