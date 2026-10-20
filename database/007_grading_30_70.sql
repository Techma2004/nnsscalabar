-- Run this once against an existing database:
--   mysql -u <user> -p nnss_calabar < database/007_grading_30_70.sql
--
-- Rebuilds the grading system the way Nigerian secondary schools run it:
--
--   * Continuous Assessment (CA) is 30% and the end-of-term Exam is 70%,
--     added together out of 100.
--       1ST TEST (10) | QUIZ (2)    | ASSIGNMENT (3) | TOTAL (15)
--       2ND TEST (10) | PROJECT (3) | NOTE (2)       | TOTAL (15)
--       EXAM (70)     | TERM'S TOTAL (100)           | GRADE
--   * Two grading scales, chosen by the class the result was entered for:
--       Senior Secondary (SSS 1-3)  WAEC / NECO 9-point scale
--         A1 75-100 Excellent | B2 70-74 Very Good | B3 65-69 Good
--         C4 60-64, C5 55-59, C6 50-54 Credit | D7 45-49, E8 40-44 Pass | F9 0-39 Fail
--       Junior Secondary (JSS 1-3)
--         A 80-100 Distinction | C 60-79 Credit | P 50-59 Pass | F 0-49 Fail
--
-- results.is_junior records which scale a result belongs to, so a student who
-- is promoted from JSS3 to SS1 keeps the grades they earned in JSS3. The
-- generated `grade` / `remark` columns read it, so every existing query,
-- view and report keeps working.
--
-- Safe to run more than once. It never rewrites marks that are already
-- recorded: results saved under the old 40/60 sheet keep their scores (their
-- grade is simply recalculated on the new scales). If you want old terms
-- re-entered on the new 30/70 sheet, do that from the Score Sheet screen.
--
-- schema.sql already contains this for fresh installs.

-- ---- 1. Mark guards -----------------------------------------------------
-- Drop the old CA-40 component guard. The new guards are only added when no
-- existing row would break them (older results may carry CA marks above 30);
-- the application validates every entry against the same maxima either way.
ALTER TABLE results DROP CONSTRAINT IF EXISTS chk_results_components;

SET @bad := (SELECT COUNT(*) FROM results
             WHERE test1_score > 10 OR quiz_score > 2 OR assignment_score > 3
                OR test2_score > 10 OR project_score > 3 OR note_score > 2);
SET @c := (SELECT COUNT(*) FROM information_schema.table_constraints
           WHERE table_schema = DATABASE() AND table_name = 'results' AND constraint_name = 'chk_results_components_v2');
SET @sql := IF(@c = 0 AND @bad = 0,
  'ALTER TABLE results ADD CONSTRAINT chk_results_components_v2 CHECK (
     (test1_score      IS NULL OR (test1_score      >= 0 AND test1_score      <= 10)) AND
     (quiz_score       IS NULL OR (quiz_score       >= 0 AND quiz_score       <= 2))  AND
     (assignment_score IS NULL OR (assignment_score >= 0 AND assignment_score <= 3))  AND
     (test2_score      IS NULL OR (test2_score      >= 0 AND test2_score      <= 10)) AND
     (project_score    IS NULL OR (project_score    >= 0 AND project_score    <= 3))  AND
     (note_score       IS NULL OR (note_score       >= 0 AND note_score       <= 2)))',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bad := (SELECT COUNT(*) FROM results WHERE ca_score > 30 OR exam_score > 70);
SET @c := (SELECT COUNT(*) FROM information_schema.table_constraints
           WHERE table_schema = DATABASE() AND table_name = 'results' AND constraint_name = 'chk_results_scheme_v2');
SET @sql := IF(@c = 0 AND @bad = 0,
  'ALTER TABLE results ADD CONSTRAINT chk_results_scheme_v2 CHECK (ca_score <= 30 AND exam_score <= 70)',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 2. Subject split: CA 30 + Exam 70 ------------------------------------
-- The application fixes every subject to this split, so bring all of them in line.
ALTER TABLE subjects MODIFY ca_max TINYINT DEFAULT 30, MODIFY exam_max TINYINT DEFAULT 70;
UPDATE subjects SET ca_max = 30, exam_max = 70 WHERE NOT (ca_max <=> 30 AND exam_max <=> 70);

-- ---- 3. Two-tier grading --------------------------------------------------
-- Only runs when results.is_junior does not exist yet, so re-running this file
-- never overwrites the per-result scale that was recorded when a sheet was saved.
SET @needs := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'results' AND column_name = 'is_junior');

SET @sql := IF(@needs,
  'ALTER TABLE results ADD COLUMN is_junior BOOLEAN NOT NULL DEFAULT FALSE AFTER exam_score',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Existing results take the scale of the class their student is in now. (A
-- result from before a promotion is graded on the student's current class;
-- everything entered from now on records the class it was entered for.)
SET @sql := IF(@needs,
  'UPDATE results r JOIN students s ON s.id = r.student_id JOIN class_levels cl ON cl.id = s.class_level_id SET r.is_junior = cl.is_junior',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@needs, 'ALTER TABLE results DROP COLUMN grade, DROP COLUMN remark', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@needs,
  'ALTER TABLE results ADD COLUMN grade VARCHAR(5) GENERATED ALWAYS AS (
     CASE
       WHEN is_junior = 1 THEN
         CASE
           WHEN (ca_score + exam_score) >= 80 THEN ''A''
           WHEN (ca_score + exam_score) >= 60 THEN ''C''
           WHEN (ca_score + exam_score) >= 50 THEN ''P''
           ELSE ''F''
         END
       ELSE
         CASE
           WHEN (ca_score + exam_score) >= 75 THEN ''A1''
           WHEN (ca_score + exam_score) >= 70 THEN ''B2''
           WHEN (ca_score + exam_score) >= 65 THEN ''B3''
           WHEN (ca_score + exam_score) >= 60 THEN ''C4''
           WHEN (ca_score + exam_score) >= 55 THEN ''C5''
           WHEN (ca_score + exam_score) >= 50 THEN ''C6''
           WHEN (ca_score + exam_score) >= 45 THEN ''D7''
           WHEN (ca_score + exam_score) >= 40 THEN ''E8''
           ELSE ''F9''
         END
     END
   ) STORED AFTER total_score',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@needs,
  'ALTER TABLE results ADD COLUMN remark VARCHAR(20) GENERATED ALWAYS AS (
     CASE
       WHEN is_junior = 1 THEN
         CASE
           WHEN (ca_score + exam_score) >= 80 THEN ''Distinction''
           WHEN (ca_score + exam_score) >= 60 THEN ''Credit''
           WHEN (ca_score + exam_score) >= 50 THEN ''Pass''
           ELSE ''Fail''
         END
       ELSE
         CASE
           WHEN (ca_score + exam_score) >= 75 THEN ''Excellent''
           WHEN (ca_score + exam_score) >= 70 THEN ''Very Good''
           WHEN (ca_score + exam_score) >= 65 THEN ''Good''
           WHEN (ca_score + exam_score) >= 50 THEN ''Credit''
           WHEN (ca_score + exam_score) >= 40 THEN ''Pass''
           ELSE ''Fail''
         END
     END
   ) STORED AFTER grade',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
