-- =====================================================
-- Migration 003: allow per-subject CA/exam weightings
-- Run once against an EXISTING nnss_calabar database.
-- Fresh installs get this from schema.sql directly.
-- =====================================================
-- The results table hardcoded CHECK (ca_score <= 30) and (exam_score <= 70),
-- so a subject configured with different maximums (e.g. CA 40 / exam 60) could
-- never have its marks saved — the database rejected them even though the
-- subject itself allowed it. Limits are now enforced per subject by the
-- application against subjects.ca_max / subjects.exam_max, which are validated
-- to total 100 so the WAEC grade scale stays correct.
--
-- MODIFY is used rather than DROP CONSTRAINT because MariaDB and MySQL name
-- inline column CHECKs differently ("ca_score" vs "results_chk_1"); redefining
-- the column removes the old inline check portably on both.
USE nnss_calabar;

ALTER TABLE results
  MODIFY ca_score   DECIMAL(5,2) DEFAULT 0,
  MODIFY exam_score DECIMAL(5,2) DEFAULT 0;

ALTER TABLE results
  ADD CONSTRAINT chk_results_ca   CHECK (ca_score   >= 0 AND ca_score   <= 100),
  ADD CONSTRAINT chk_results_exam CHECK (exam_score >= 0 AND exam_score <= 100);

-- Safety net: correct any subject whose maximums do not total 100.
UPDATE subjects SET ca_max = 30, exam_max = 70 WHERE (ca_max + exam_max) <> 100;
