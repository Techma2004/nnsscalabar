-- Run this once against the existing production database:
--   mysql -u <user> -p <database> < database/migrations/002_result_rejection.sql
--
-- Adds the columns needed for the HOD "Disapprove" action. schema.sql has
-- also been updated so a fresh install includes these from the start.

ALTER TABLE results
  ADD COLUMN rejected_at TIMESTAMP NULL DEFAULT NULL AFTER approved_at,
  ADD COLUMN rejected_by INT DEFAULT NULL AFTER rejected_at,
  ADD COLUMN rejection_note TEXT DEFAULT NULL AFTER rejected_by,
  ADD CONSTRAINT fk_results_rejected_by FOREIGN KEY (rejected_by) REFERENCES users(id);
