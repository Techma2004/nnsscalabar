-- Migration 008: persistent account lockout + login audit trail.
-- Run once on an existing database (take a backup first):
--   mysql -u <user> -p nnss_calabar < database/008_login_lockout.sql
-- Safe to run more than once. Fresh installs get all of this from schema.sql.
--
--   users.failed_attempts / users.locked_until  survive a server restart; the
--       account locks for 15 minutes after 10 consecutive wrong passwords.
--   login_attempts  one row per sign-in attempt (ip, user_code, success, ts),
--       read by the credential-stuffing alert on the admin Security alerts page.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'failed_attempts'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN failed_attempts INT NOT NULL DEFAULT 0',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'locked_until'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN locked_until DATETIME NULL DEFAULT NULL',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS login_attempts (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  ip        VARCHAR(45) NOT NULL,
  user_code VARCHAR(20) NOT NULL,
  success   BOOLEAN NOT NULL,
  ts        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_attempts_ts (ts),
  INDEX idx_login_attempts_ip_ts (ip, ts)
);
