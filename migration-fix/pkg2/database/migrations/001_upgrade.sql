-- =====================================================
-- Upgrade an existing nnss_calabar database to the current schema.
-- Fresh installs get all of this directly from schema.sql instead —
-- only run this file against a database created before this migration
-- existed.
--
-- Safe to run more than once and safe to run on a database that already
-- has some (but not all) of these changes applied — every step checks
-- whether it is needed first, so nothing errors out on a column, index
-- or constraint that already exists. Run it, and if in doubt, run it
-- again; it will simply do nothing on a second pass.
--
-- Covers, in order:
--   1. Student lifecycle status (active/pending/withdrawn/graduated)
--   2. Dynamic class levels and arms (rename/add/retire without code changes)
--   3. Per-subject CA/exam weightings (no longer hardcoded to 30/70)
-- =====================================================
USE nnss_calabar;

-- ---------------------------------------------------------------------
-- 1. Student lifecycle status
-- ---------------------------------------------------------------------
-- A student's enrollment status is distinct from users.is_active (which
-- only gates login). This lets 'yet to resume' and 'withdrawn' be tracked
-- without ever deleting the student's account or academic history.

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = 'status');
SET @sql := IF(@exists = 0,
  "ALTER TABLE students ADD COLUMN status ENUM('active','pending','withdrawn','graduated') NOT NULL DEFAULT 'active' AFTER track",
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = 'status_reason');
SET @sql := IF(@exists = 0,
  'ALTER TABLE students ADD COLUMN status_reason VARCHAR(160) NULL AFTER status',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = 'status_updated_at');
SET @sql := IF(@exists = 0,
  'ALTER TABLE students ADD COLUMN status_updated_at TIMESTAMP NULL AFTER status_reason',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill: any student whose account is already deactivated is treated as
-- withdrawn rather than active, so existing data stays consistent with the
-- new status column instead of silently defaulting everyone to 'active'.
UPDATE students s
JOIN users u ON u.id = s.user_id
SET s.status = 'withdrawn', s.status_updated_at = NOW()
WHERE u.is_active = 0 AND s.status = 'active';

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND INDEX_NAME = 'idx_students_status');
SET @sql := IF(@exists = 0, 'CREATE INDEX idx_students_status ON students(status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 2. Dynamic class levels and arms
-- ---------------------------------------------------------------------
-- Junior/senior and active/retired are recorded as data instead of being
-- inferred from hardcoded name lists in application code — otherwise
-- renaming or adding a class/arm silently breaks assignment provisioning.

ALTER TABLE class_levels MODIFY COLUMN level_name VARCHAR(20) NOT NULL;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'class_levels' AND COLUMN_NAME = 'is_junior');
SET @sql := IF(@exists = 0,
  'ALTER TABLE class_levels ADD COLUMN is_junior BOOLEAN NOT NULL DEFAULT FALSE AFTER level_name',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'class_levels' AND COLUMN_NAME = 'sort_order');
SET @sql := IF(@exists = 0,
  'ALTER TABLE class_levels ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER is_junior',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill from the existing NNSS naming convention so current data stays correct.
UPDATE class_levels SET is_junior = 1 WHERE level_name LIKE 'JSS%' AND is_junior = 0;
UPDATE class_levels SET sort_order = id WHERE sort_order = 0;

ALTER TABLE arms
  MODIFY COLUMN arm_name VARCHAR(30) NOT NULL,
  MODIFY COLUMN category VARCHAR(50);

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arms' AND COLUMN_NAME = 'is_active');
SET @sql := IF(@exists = 0,
  'ALTER TABLE arms ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arms' AND INDEX_NAME = 'idx_arms_active');
SET @sql := IF(@exists = 0, 'CREATE INDEX idx_arms_active ON arms(is_active)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 3. Per-subject CA/exam weightings
-- ---------------------------------------------------------------------
-- results.ca_score/exam_score no longer hardcode a 0-30/0-70 CHECK — the
-- real limits are each subject's own ca_max/exam_max, enforced by the
-- application. MODIFY (rather than DROP CONSTRAINT) is used because
-- MariaDB and MySQL name inline column CHECKs differently ("ca_score" vs
-- "results_chk_1"); redefining the column removes the old inline check
-- portably on both, and is harmless to repeat.

ALTER TABLE results
  MODIFY ca_score   DECIMAL(5,2) DEFAULT 0,
  MODIFY exam_score DECIMAL(5,2) DEFAULT 0;

SET @exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'results' AND CONSTRAINT_NAME = 'chk_results_ca');
SET @sql := IF(@exists = 0,
  'ALTER TABLE results ADD CONSTRAINT chk_results_ca CHECK (ca_score >= 0 AND ca_score <= 100)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'results' AND CONSTRAINT_NAME = 'chk_results_exam');
SET @sql := IF(@exists = 0,
  'ALTER TABLE results ADD CONSTRAINT chk_results_exam CHECK (exam_score >= 0 AND exam_score <= 100)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Safety net: correct any subject whose maximums do not total 100 (the app
-- now requires this, since grade/remark are computed on a 100-point scale).
UPDATE subjects SET ca_max = 30, exam_max = 70 WHERE (ca_max + exam_max) <> 100;
