-- Run once on an existing database:
--   mysql -u <user> -p nnss_calabar < database/006_news_team_requests_contacts.sql
-- (a fresh install gets all of this from database/schema.sql)
-- =====================================================
-- 17. SCHOOL NEWS TEAM, BLOG & NEWSLETTER, CHANGE REQUESTS, CONTACTS
-- (migration 006 - safe to run more than once)
-- =====================================================

-- New 'editor' role for the school article / news team. They can edit the public
-- blog and newsletter pages and nothing else.
ALTER TABLE users MODIFY role ENUM('student','teacher','hod','admin','commandant','editor') NOT NULL;

-- Public blog posts and newsletter items (one table, told apart by "kind").
CREATE TABLE IF NOT EXISTS posts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  kind        ENUM('blog','newsletter') NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT NOT NULL,
  image_url   VARCHAR(255) NULL,
  event_date  DATE NOT NULL,
  status      ENUM('draft','published') NOT NULL DEFAULT 'published',
  created_by  INT NULL,
  updated_by  INT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_posts_public (kind, status, event_date),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Student requests to change arm, or to add / drop a subject. Reviewed by an HOD.
CREATE TABLE IF NOT EXISTS change_requests (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  student_id    INT NOT NULL,
  session_id    INT NOT NULL,
  request_type  ENUM('arm','subject_add','subject_drop') NOT NULL,
  target_arm_id INT NULL,
  subject_id    INT NULL,
  reason        VARCHAR(500) NOT NULL,
  status        ENUM('pending','approved','declined','cancelled') NOT NULL DEFAULT 'pending',
  reviewed_by   INT NULL,
  review_note   VARCHAR(500) NULL,
  reviewed_at   TIMESTAMP NULL DEFAULT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_change_requests_status (status, request_type),
  KEY idx_change_requests_student (student_id, status),
  FOREIGN KEY (student_id)    REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id)    REFERENCES academic_sessions(id),
  FOREIGN KEY (target_arm_id) REFERENCES arms(id),
  FOREIGN KEY (subject_id)    REFERENCES subjects(id),
  FOREIGN KEY (reviewed_by)   REFERENCES users(id) ON DELETE SET NULL
);

-- First-time content: the posts that were typed straight into blog.html and
-- newsletter.html. Added only while the table is completely empty, so deleting
-- a post later is never undone by re-running this file.
INSERT INTO posts (kind, title, body, image_url, event_date, status)
SELECT kind, title, body, image_url, event_date, status FROM (
  SELECT 'blog' AS kind, 'STEM Competition won by NNSS CAL [2025]' AS title, 'The Chief of Naval Staff organizes yearly competitions for all NN welfare schools. Through determination, hardwork and commitment, NNSS Calabar emerged first at the command level and third nationwide.' AS body, 'img-2.png' AS image_url, CAST('2025-05-29' AS DATE) AS event_date, 'published' AS status
  UNION ALL
  SELECT 'blog', 'Engineering Department', 'NNSS Calabar in its bid to produce outstanding individuals in works of life, provides a platform to give engineering a practical means of learning through facilitated labs and termly external competitions with other schools.', 'img-3.png', '2026-02-20', 'published'
  UNION ALL
  SELECT 'blog', 'Students'' Carol night 2025', 'NNSS Calabar pays keen attention to the religious growth and moral development of its students. It organizes a yearly carol night involving candlelight processions, inter-house carol singing competitions, a fireworks display and much more.', 'img-4.png', '2025-12-07', 'published'
  UNION ALL
  SELECT 'blog', 'Night View of the School Environment', 'At NNSS Calabar, the management treats student security as a top priority. Its newly installed NDDC streetlights aid in the lighting of the premises, making the environment much safer.', 'img-5.png', '2026-04-05', 'published'
  UNION ALL
  SELECT 'blog', 'Sport and Activities', 'The school provides facilities and equipment for sports activities, improving students'' athleticism and sportsmanship. It also hosts sessional cultural days to celebrate our cultural heritage.', 'slider-05.png', '2026-04-25', 'published'
  UNION ALL
  SELECT 'blog', 'Academic Excellence', 'NNSS Calabar has consistently produced students with outstanding grades from JAMB to WAEC to NECO, and even the JSS3 BECE.', 'img-6.png', '2026-05-08', 'published'
  UNION ALL
  SELECT 'newsletter', 'Enrollment Open for 2026/2027 Academic Session', 'Admissions are now open for the 2026/2027 academic session for JSS1 and SS1. Interested parents and guardians should visit the school administration office or contact us for the admission forms and requirements. The new session begins in September 2026.', NULL, '2026-05-11', 'published'
  UNION ALL
  SELECT 'newsletter', 'New Digital Portal Launched', 'NNSS Calabar has launched a comprehensive digital portal system for students, teachers, and administrators. The portal allows students to view their results online, teachers to upload scores, and administrators to manage school data efficiently. All users should log in with their credentials to access the new system.', NULL, '2026-04-15', 'published'
  UNION ALL
  SELECT 'newsletter', 'Inter-House Sports Competition 2026', 'The annual inter-house sports competition was a huge success with students from all houses (ADEKEYE, ADENIYI, AJADI and BAJE) participating enthusiastically. House ADEKEYE emerged as the overall champions. Thank you to all teachers, parents, and students who made this event possible.', NULL, '2026-03-20', 'published'
  UNION ALL
  SELECT 'newsletter', 'Library Expansion Complete', 'The school library expansion project has been completed successfully. The new wing features additional reading areas, a digital resource center with computers, and an expanded collection of over 5,000 new books. Students are encouraged to utilize this valuable resource for their studies.', NULL, '2026-03-05', 'published'
  UNION ALL
  SELECT 'newsletter', 'Parent-Teacher Association Meeting', 'The PTA meeting held on February 15, 2026, discussed important matters including the new academic calendar, school improvement projects, and the digital portal initiative. All parents and guardians are encouraged to attend future meetings to stay involved in their children''s education.', NULL, '2026-02-15', 'published'
  UNION ALL
  SELECT 'newsletter', 'Naval Career Day 2026', 'Naval Career Day was organized to expose students to various career paths within the Nigerian Navy. Naval officers visited the school to give presentations on life in the Navy, educational requirements, and opportunities available. Students were inspired by the stories of naval heroes and the opportunities that await them.', NULL, '2026-01-20', 'published'
  UNION ALL
  SELECT 'newsletter', 'Second Term Examination Results Released', 'Second term examination results for the 2025/2026 academic session have been released. Students can now log in to the school portal to view their individual results and subject scores. Parents are encouraged to review their children''s performance and discuss areas for improvement with subject teachers.', NULL, '2026-01-10', 'published'
) AS first_posts
WHERE NOT EXISTS (SELECT 1 FROM posts);
