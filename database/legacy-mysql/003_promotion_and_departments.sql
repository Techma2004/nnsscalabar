-- Run this once against the existing production database:
--   mysql -u <user> -p <database> < database/migrations/003_promotion_and_departments.sql
--
-- Adds what the end-of-session promotion feature needs: a 'repeating'
-- student status (for students an admin marks to stay in their current
-- class instead of moving up), and a timestamp on academic_sessions so the
-- same session's promotion can't be silently run twice by accident.
-- schema.sql has also been updated so a fresh install includes these.

ALTER TABLE students
  MODIFY COLUMN status ENUM('active','pending','withdrawn','graduated','repeating') NOT NULL DEFAULT 'active';

ALTER TABLE academic_sessions
  ADD COLUMN promoted_at TIMESTAMP NULL DEFAULT NULL;
