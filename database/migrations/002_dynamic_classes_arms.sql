-- =====================================================
-- Migration 002: dynamic class levels and arms
-- Run once against an EXISTING nnss_calabar database.
-- Fresh installs get all of this from schema.sql directly.
-- =====================================================
USE nnss_calabar;

-- Class levels: widen the name, and record junior/senior as data rather than
-- inferring it from hardcoded name lists in application code.
ALTER TABLE class_levels
  MODIFY COLUMN level_name VARCHAR(20) NOT NULL,
  ADD COLUMN is_junior  BOOLEAN NOT NULL DEFAULT FALSE AFTER level_name,
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER is_junior;

-- Backfill from the existing NNSS naming convention so current data stays correct.
UPDATE class_levels SET is_junior = 1 WHERE level_name LIKE 'JSS%';
UPDATE class_levels SET sort_order = id WHERE sort_order = 0;

-- Arms: widen the name/category, and allow retiring an arm without deleting it
-- (students and results reference arms permanently).
ALTER TABLE arms
  MODIFY COLUMN arm_name VARCHAR(30) NOT NULL,
  MODIFY COLUMN category VARCHAR(50),
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX idx_arms_active ON arms(is_active);
