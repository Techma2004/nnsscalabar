-- Run this once against an existing database:
--   mysql -u <user> -p nnss_calabar < database/004_ca_sheet_scheme.sql
--
-- Moves the result system onto the school's Continuous Assessment Sheet:
--
--   1ST TEST (15) | QUIZ (5) | ASSIGNMENT (5) | TOTAL (25)
--   2ND TEST (5)  | PROJECT (5) | NOTE (5)     | TOTAL (15)
--   EXAM (60)     | TERM'S TOTAL (100)         | GRADE
--
-- results.ca_score stays as the stored CA total (sum of the six components,
-- max 40) and results.exam_score stays as the exam mark (max 60), so
-- total_score / grade / remark (generated columns) and every existing view,
-- report and approval query keep working unchanged. Rows entered before this
-- migration keep their ca_score and have NULL components.
--
-- schema.sql already contains this for fresh installs; it is safe to run
-- schema.sql or this file more than once.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'results' AND column_name = 'test1_score'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE results
     ADD COLUMN test1_score      DECIMAL(5,2) NULL DEFAULT NULL AFTER teacher_id,
     ADD COLUMN quiz_score       DECIMAL(5,2) NULL DEFAULT NULL AFTER test1_score,
     ADD COLUMN assignment_score DECIMAL(5,2) NULL DEFAULT NULL AFTER quiz_score,
     ADD COLUMN test2_score      DECIMAL(5,2) NULL DEFAULT NULL AFTER assignment_score,
     ADD COLUMN project_score    DECIMAL(5,2) NULL DEFAULT NULL AFTER test2_score,
     ADD COLUMN note_score       DECIMAL(5,2) NULL DEFAULT NULL AFTER project_score',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Component range guards (a blank/NULL component is allowed: "not recorded").
SET @c := (SELECT COUNT(*) FROM information_schema.table_constraints
           WHERE table_schema = DATABASE() AND table_name = 'results' AND constraint_name = 'chk_results_components');
SET @sql := IF(@c = 0,
  'ALTER TABLE results ADD CONSTRAINT chk_results_components CHECK (
     (test1_score      IS NULL OR (test1_score      >= 0 AND test1_score      <= 15)) AND
     (quiz_score       IS NULL OR (quiz_score       >= 0 AND quiz_score       <= 5))  AND
     (assignment_score IS NULL OR (assignment_score >= 0 AND assignment_score <= 5))  AND
     (test2_score      IS NULL OR (test2_score      >= 0 AND test2_score      <= 5))  AND
     (project_score    IS NULL OR (project_score    >= 0 AND project_score    <= 5))  AND
     (note_score       IS NULL OR (note_score       >= 0 AND note_score       <= 5)))',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- New default split: CA 40 + Exam 60 = 100. Only subjects still on the old
-- default 30/70 are moved; anything a school customised is left alone.
ALTER TABLE subjects
  MODIFY ca_max   TINYINT DEFAULT 40,
  MODIFY exam_max TINYINT DEFAULT 60;

UPDATE subjects SET ca_max = 40, exam_max = 60 WHERE ca_max = 30 AND exam_max = 70;
