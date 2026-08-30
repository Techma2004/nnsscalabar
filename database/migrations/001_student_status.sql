-- =====================================================
-- Migration: student lifecycle status
-- Run this once against an EXISTING nnss_calabar database.
-- Fresh installs get this column directly from schema.sql instead.
-- =====================================================
USE nnss_calabar;

ALTER TABLE students
  ADD COLUMN status ENUM('active','pending','withdrawn','graduated') NOT NULL DEFAULT 'active' AFTER track,
  ADD COLUMN status_reason VARCHAR(160) NULL AFTER status,
  ADD COLUMN status_updated_at TIMESTAMP NULL AFTER status_reason;

-- Backfill: any student whose account is already deactivated is treated as
-- withdrawn rather than active, so existing data stays consistent with the
-- new status column instead of silently defaulting everyone to 'active'.
UPDATE students s
JOIN users u ON u.id = s.user_id
SET s.status = 'withdrawn', s.status_updated_at = NOW()
WHERE u.is_active = 0;

CREATE INDEX idx_students_status ON students(status);
