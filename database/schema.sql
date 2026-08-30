-- =====================================================
--  NNSS CALABAR — DATABASE SCHEMA
--  Nigerian Navy Secondary School, Calabar
--  Engine: MySQL 8.0+ / MariaDB 10.6+
-- =====================================================

CREATE DATABASE IF NOT EXISTS nnss_calabar CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE nnss_calabar;

-- =====================================================
-- 1. ACADEMIC SESSIONS & TERMS
-- =====================================================
CREATE TABLE academic_sessions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  session_name  VARCHAR(20) NOT NULL UNIQUE,
  is_current    BOOLEAN DEFAULT FALSE,
  start_date    DATE,
  end_date      DATE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE terms (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  session_id    INT NOT NULL,
  term_number   TINYINT NOT NULL,
  term_name     VARCHAR(30) NOT NULL,
  start_date    DATE,
  end_date      DATE,
  is_current    BOOLEAN DEFAULT FALSE,
  result_locked BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE,
  UNIQUE KEY (session_id, term_number)
);

-- =====================================================
-- 2. DEPARTMENTS
-- =====================================================
CREATE TABLE departments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  dept_name   VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO departments (dept_name) VALUES
  ('Sciences'),
  ('Languages'),
  ('Arts & Commercial'),
  ('Technical'),
  ('Social Studies'),
  ('Administration');

-- =====================================================
-- 3. SUBJECTS
-- =====================================================
CREATE TABLE subjects (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  subject_name VARCHAR(80) NOT NULL UNIQUE,
  dept_id      INT,
  ca_max       TINYINT DEFAULT 30,
  exam_max     TINYINT DEFAULT 70,
  is_active    BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (dept_id) REFERENCES departments(id)
);

-- FIXED: removed duplicate 'Igbo' (kept one, dept_id 1)
INSERT INTO subjects (subject_name, dept_id) VALUES
  ('English Language',             2),
  ('Mathematics',                  1),
  ('French',                       4),        -- junior & senior share this
  ('National Values',              5),
  ('Efik',                         1),
  ('Intermediate science',         3),
  ('Trade',                        5),
  ('Cisco',                        1),
  ('Digital technologies',         1),
  ('Physics',                      1),
  ('Chemistry',                    1),
  ('Further Mathematics',          1),
  ('Biology',                      1),
  ('Computer Studies',             1),
  ('Civic Education',              5),
  ('Geography',                    5),
  ('Technical Drawing',            4),
  ('Food & Nutrition',             3),
  ('Electrical Installation',      4),
  ('Igbo',                         1),        -- only ONE Igbo entry
  ('French Language',              2),        -- separate name for senior
  ('Catering Craft Practice',      3),
  ('Economics',                    3),
  ('Visual Arts',                  3),
  ('Christian Religious Studies',  5),
  ('Accounting',                   3),
  ('Commerce',                     3),
  ('Literature in English',        2),
  ('Government',                   5);

INSERT INTO subjects (subject_name, dept_id) VALUES
  ('Basic Science & Technology', 1),
  ('Cultural & Creative Arts', 3),
  ('History', 5);

-- =====================================================
-- 4. CLASS LEVELS & ARMS
-- =====================================================
CREATE TABLE class_levels (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  level_name VARCHAR(10) NOT NULL UNIQUE
);

INSERT INTO class_levels (level_name) VALUES
  ('JSS1'),('JSS2'),('JSS3'),
  ('SS1'),('SS2'),('SS3');

CREATE TABLE arms (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  arm_name VARCHAR(10) NOT NULL UNIQUE,
  arm_type ENUM('science','technical','arts','junior') NOT NULL,
  category VARCHAR(30)
);

INSERT INTO arms (arm_name, arm_type, category) VALUES
  ('AGU',   'science',   'Senior Science'),
  ('AYAM',  'science',   'Senior Science'),
  ('DAMISA','science',   'Senior Science'),
  ('EKUN',  'technical', 'Senior Technical'),
  ('EKPE',  'technical', 'Senior Technical'),
  ('SIRI',  'arts',      'Senior Arts & Commercial');

-- =====================================================
-- 5. TRACK-SUBJECT MAPPING (empty, fill later)
-- =====================================================
CREATE TABLE track_subjects (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  track      ENUM('junior','science','technical','arts') NOT NULL,
  subject_id INT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  UNIQUE KEY (track, subject_id)
);

-- Default curriculum mapping. This is intentionally data-driven so the school
-- can change subjects later without changing application code.
INSERT INTO track_subjects (track, subject_id)
SELECT 'junior', id FROM subjects WHERE subject_name IN (
  'English Language','Mathematics','National Values','Basic Science & Technology','Cultural & Creative Arts',
  'History','Cisco','Digital technologies','French','Efik','Igbo','Trade'
);
INSERT INTO track_subjects (track, subject_id)
SELECT 'science', id FROM subjects WHERE subject_name IN (
  'English Language','Mathematics','Physics','Chemistry','Biology','Further Mathematics','Computer Studies',
  'Civic Education','Geography','Cisco','Technical Drawing'
);
INSERT INTO track_subjects (track, subject_id)
SELECT 'technical', id FROM subjects WHERE subject_name IN (
  'English Language','Mathematics','Physics','Chemistry','Computer Studies','Civic Education','Technical Drawing',
  'Electrical Installation','Food & Nutrition','Catering Craft Practice'
);
INSERT INTO track_subjects (track, subject_id)
SELECT 'arts', id FROM subjects WHERE subject_name IN (
  'English Language','Mathematics','Christian Religious Studies','Literature in English','Economics','Accounting',
  'Commerce','Government','French Language','Visual Arts','Civic Education','Geography'
);

-- =====================================================
-- 6. USERS
-- =====================================================
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_code     VARCHAR(20) NOT NULL UNIQUE,
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(120) UNIQUE,
  phone         VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('student','teacher','hod','admin','commandant') NOT NULL,
  gender        ENUM('M','F') DEFAULT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  last_login    DATETIME,
  profile_photo VARCHAR(255),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =====================================================
-- 7. STUDENTS
-- =====================================================
CREATE TABLE students (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL UNIQUE,
  admission_no    VARCHAR(20) UNIQUE,
  class_level_id  INT NOT NULL,
  arm_id          INT NOT NULL,
  date_of_birth   DATE,
  parent_name     VARCHAR(120),
  parent_phone    VARCHAR(20),
  date_admitted   DATE,
  is_boarder      BOOLEAN DEFAULT FALSE,
  track           ENUM('junior','science','technical','arts') NOT NULL,
  -- Enrollment lifecycle, independent of users.is_active (which only gates login).
  -- 'active': currently attending. 'pending': admitted/returning but yet to resume.
  -- 'withdrawn': permanently left the school (transfer, expulsion, etc).
  -- 'graduated': completed studies — record kept, no ongoing portal access.
  status             ENUM('active','pending','withdrawn','graduated') NOT NULL DEFAULT 'active',
  status_reason      VARCHAR(160) NULL,
  status_updated_at  TIMESTAMP NULL,
  FOREIGN KEY (user_id)        REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (class_level_id) REFERENCES class_levels(id),
  FOREIGN KEY (arm_id)         REFERENCES arms(id)
);

-- =====================================================
-- 8. TEACHERS
-- =====================================================
CREATE TABLE teachers (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL UNIQUE,
  staff_no    VARCHAR(20) UNIQUE,
  dept_id     INT,
  qualification VARCHAR(100),
  date_joined DATE,
  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (dept_id)  REFERENCES departments(id)
);

CREATE TABLE teacher_subjects (
  teacher_id  INT NOT NULL,
  subject_id  INT NOT NULL,
  PRIMARY KEY (teacher_id, subject_id),
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE TABLE teacher_class_assignments (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id    INT NOT NULL,
  subject_id    INT NOT NULL,
  class_level_id INT NOT NULL,
  arm_id        INT NOT NULL,
  session_id    INT NOT NULL,
  FOREIGN KEY (teacher_id)     REFERENCES teachers(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id)     REFERENCES subjects(id),
  FOREIGN KEY (class_level_id) REFERENCES class_levels(id),
  FOREIGN KEY (arm_id)         REFERENCES arms(id),
  FOREIGN KEY (session_id)     REFERENCES academic_sessions(id),
  UNIQUE KEY (teacher_id, subject_id, class_level_id, arm_id, session_id)
);

-- =====================================================
-- 9. HODs
-- =====================================================
CREATE TABLE hods (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL UNIQUE,
  dept_id     INT NOT NULL UNIQUE,
  appointed_date DATE,
  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (dept_id)  REFERENCES departments(id)
);

-- =====================================================
-- 10. STUDENT SUBJECT ENROLLMENT
-- =====================================================
CREATE TABLE student_subject_enrollment (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  student_id  INT NOT NULL,
  subject_id  INT NOT NULL,
  session_id  INT NOT NULL,
  enrolled_by INT,
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active   BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (student_id)  REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id)  REFERENCES subjects(id),
  FOREIGN KEY (session_id)  REFERENCES academic_sessions(id),
  UNIQUE KEY (student_id, subject_id, session_id)
);

-- =====================================================
-- 11. RESULTS
-- =====================================================
CREATE TABLE results (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  student_id      INT NOT NULL,
  subject_id      INT NOT NULL,
  term_id         INT NOT NULL,
  teacher_id      INT NOT NULL,
  ca_score        DECIMAL(5,2) DEFAULT 0 CHECK (ca_score >= 0 AND ca_score <= 30),
  exam_score      DECIMAL(5,2) DEFAULT 0 CHECK (exam_score >= 0 AND exam_score <= 70),
  total_score     DECIMAL(5,2) GENERATED ALWAYS AS (ca_score + exam_score) STORED,
  grade           VARCHAR(5)   GENERATED ALWAYS AS (
    CASE
      WHEN (ca_score + exam_score) >= 75 THEN 'A1'
      WHEN (ca_score + exam_score) >= 70 THEN 'B2'
      WHEN (ca_score + exam_score) >= 65 THEN 'B3'
      WHEN (ca_score + exam_score) >= 60 THEN 'C4'
      WHEN (ca_score + exam_score) >= 55 THEN 'C5'
      WHEN (ca_score + exam_score) >= 50 THEN 'C6'
      WHEN (ca_score + exam_score) >= 45 THEN 'D7'
      WHEN (ca_score + exam_score) >= 40 THEN 'E8'
      ELSE 'F9'
    END
  ) STORED,
  remark          VARCHAR(20) GENERATED ALWAYS AS (
    CASE
      WHEN (ca_score + exam_score) >= 75 THEN 'Excellent'
      WHEN (ca_score + exam_score) >= 65 THEN 'Very Good'
      WHEN (ca_score + exam_score) >= 55 THEN 'Good'
      WHEN (ca_score + exam_score) >= 50 THEN 'Credit'
      WHEN (ca_score + exam_score) >= 40 THEN 'Pass'
      ELSE 'Fail'
    END
  ) STORED,
  uploaded_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_approved     BOOLEAN DEFAULT FALSE,
  approved_by     INT DEFAULT NULL,
  approved_at     TIMESTAMP DEFAULT NULL,
  FOREIGN KEY (student_id)  REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id)  REFERENCES subjects(id),
  FOREIGN KEY (term_id)     REFERENCES terms(id),
  FOREIGN KEY (teacher_id)  REFERENCES teachers(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  UNIQUE KEY (student_id, subject_id, term_id)
);

-- =====================================================
-- 12. RESULT APPROVAL LOG
-- =====================================================
CREATE TABLE result_approval_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  result_id   INT NOT NULL,
  action      ENUM('approved','rejected','revised') NOT NULL,
  actor_id    INT NOT NULL,
  note        TEXT,
  acted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id)  REFERENCES users(id)
);

-- =====================================================
-- 13. ATTENDANCE
-- =====================================================
CREATE TABLE attendance (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  student_id  INT NOT NULL,
  term_id     INT NOT NULL,
  att_date    DATE NOT NULL,
  status      ENUM('present','absent','late','excused') DEFAULT 'present',
  recorded_by INT,
  FOREIGN KEY (student_id)   REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (term_id)      REFERENCES terms(id),
  FOREIGN KEY (recorded_by)  REFERENCES users(id),
  UNIQUE KEY (student_id, att_date)
);

CREATE VIEW attendance_summary AS
  SELECT
    s.id AS student_id,
    u.full_name,
    t.term_name,
    ac.session_name,
    COUNT(CASE WHEN a.status='present' THEN 1 END) AS days_present,
    COUNT(CASE WHEN a.status='absent'  THEN 1 END) AS days_absent,
    COUNT(CASE WHEN a.status='late'    THEN 1 END) AS days_late,
    COUNT(*) AS total_days,
    ROUND(COUNT(CASE WHEN a.status='present' THEN 1 END) / COUNT(*) * 100, 1) AS attendance_pct
  FROM attendance a
  JOIN students s    ON a.student_id = s.id
  JOIN users u       ON s.user_id = u.id
  JOIN terms t       ON a.term_id = t.id
  JOIN academic_sessions ac ON t.session_id = ac.id
  GROUP BY s.id, u.full_name, t.id, t.term_name, ac.session_name;

-- =====================================================
-- 14. ANNOUNCEMENTS
-- =====================================================
CREATE TABLE announcements (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  body        TEXT NOT NULL,
  type        ENUM('info','warn','success','danger') DEFAULT 'info',
  author_id   INT,
  audience    SET('student','teacher','hod','admin','commandant') DEFAULT 'student,teacher,hod,admin,commandant',
  is_pinned   BOOLEAN DEFAULT FALSE,
  publish_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP DEFAULT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

-- =====================================================
-- 15. ACTIVITY LOG
-- =====================================================
CREATE TABLE activity_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id   INT,
  detail      JSON,
  ip_address  VARCHAR(45),
  logged_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- =====================================================
-- 16. USEFUL VIEWS
-- =====================================================
CREATE VIEW student_result_sheet AS
  SELECT
    u.user_code     AS student_id,
    u.full_name     AS student_name,
    cl.level_name   AS class,
    a.arm_name      AS arm,
    ac.session_name AS session,
    t.term_name     AS term,
    sub.subject_name,
    r.ca_score,
    r.exam_score,
    r.total_score,
    r.grade,
    r.remark,
    r.is_approved,
    tu.full_name    AS uploaded_by
  FROM results r
  JOIN students s   ON r.student_id = s.id
  JOIN users u      ON s.user_id = u.id
  JOIN class_levels cl ON s.class_level_id = cl.id
  JOIN arms a       ON s.arm_id = a.id
  JOIN terms t      ON r.term_id = t.id
  JOIN academic_sessions ac ON t.session_id = ac.id
  JOIN subjects sub ON r.subject_id = sub.id
  JOIN teachers tch ON r.teacher_id = tch.id
  JOIN users tu     ON tch.user_id = tu.id;

CREATE VIEW class_performance AS
  SELECT
    cl.level_name   AS class,
    a.arm_name      AS arm,
    sub.subject_name,
    t.term_name     AS term,
    ac.session_name AS session,
    COUNT(r.id)     AS num_students,
    ROUND(AVG(r.total_score),1) AS avg_score,
    MAX(r.total_score)          AS highest,
    MIN(r.total_score)          AS lowest,
    COUNT(CASE WHEN r.total_score >= 50 THEN 1 END) AS passes,
    COUNT(CASE WHEN r.total_score  < 50 THEN 1 END) AS failures,
    ROUND(COUNT(CASE WHEN r.total_score >= 50 THEN 1 END)/COUNT(*)*100,1) AS pass_rate
  FROM results r
  JOIN students s   ON r.student_id = s.id
  JOIN class_levels cl ON s.class_level_id = cl.id
  JOIN arms a       ON s.arm_id = a.id
  JOIN subjects sub ON r.subject_id = sub.id
  JOIN terms t      ON r.term_id = t.id
  JOIN academic_sessions ac ON t.session_id = ac.id
  WHERE r.is_approved = TRUE
  GROUP BY cl.level_name, a.arm_name, sub.subject_name, t.id, ac.id;

CREATE VIEW top_performers AS
  SELECT
    u.user_code     AS student_id,
    u.full_name     AS student_name,
    cl.level_name   AS class,
    a.arm_name      AS arm,
    ac.session_name AS session,
    t.term_name     AS term,
    ROUND(AVG(r.total_score),1) AS average_score,
    COUNT(r.id)                 AS subjects_taken,
    RANK() OVER (PARTITION BY r.term_id, s.class_level_id ORDER BY AVG(r.total_score) DESC) AS class_rank,
    RANK() OVER (PARTITION BY r.term_id ORDER BY AVG(r.total_score) DESC) AS overall_rank
  FROM results r
  JOIN students s   ON r.student_id = s.id
  JOIN users u      ON s.user_id = u.id
  JOIN class_levels cl ON s.class_level_id = cl.id
  JOIN arms a       ON s.arm_id = a.id
  JOIN terms t      ON r.term_id = t.id
  JOIN academic_sessions ac ON t.session_id = ac.id
  WHERE r.is_approved = TRUE
  GROUP BY r.student_id, r.term_id;

CREATE VIEW teacher_upload_progress AS
  SELECT
    tu.full_name    AS teacher_name,
    tu.user_code    AS teacher_id,
    sub.subject_name,
    d.dept_name     AS department,
    t.term_name,
    ac.session_name,
    COUNT(DISTINCT tca.arm_id)   AS arms_assigned,
    COUNT(DISTINCT r.student_id) AS scores_uploaded,
    MAX(r.uploaded_at)           AS last_upload
  FROM teacher_class_assignments tca
  JOIN teachers tch ON tca.teacher_id = tch.id
  JOIN users tu     ON tch.user_id = tu.id
  JOIN subjects sub ON tca.subject_id = sub.id
  JOIN departments d ON tch.dept_id = d.id
  JOIN terms t      ON tca.session_id = t.session_id
  JOIN academic_sessions ac ON t.session_id = ac.id
  LEFT JOIN results r ON r.teacher_id = tch.id AND r.subject_id = sub.id AND r.term_id = t.id
  GROUP BY tch.id, sub.id, t.id;

-- =====================================================
-- 18. SAMPLE DATA SEED
-- =====================================================

INSERT INTO academic_sessions (session_name, is_current, start_date, end_date) VALUES
  ('2025/2026', FALSE, '2025-09-01', '2026-07-31'),
  ('2026/2027', TRUE,  '2026-09-01', '2027-07-31');

INSERT INTO terms (session_id, term_number, term_name, start_date, end_date, is_current, result_locked) VALUES
  (2, 1, 'First Term',  '2026-09-01', '2026-12-18', TRUE, FALSE),
  (2, 2, 'Second Term', '2027-01-11', '2027-04-09', FALSE, FALSE),
  (2, 3, 'Third Term',  '2027-04-26', '2027-07-23', FALSE, FALSE);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_results_student   ON results(student_id);
CREATE INDEX idx_results_term      ON results(term_id);
CREATE INDEX idx_results_subject   ON results(subject_id);
CREATE INDEX idx_results_teacher   ON results(teacher_id);
CREATE INDEX idx_results_approved  ON results(is_approved);
CREATE INDEX idx_attendance_student ON attendance(student_id, att_date);
CREATE INDEX idx_activity_user     ON activity_log(user_id, logged_at);
CREATE INDEX idx_users_role        ON users(role, is_active);
CREATE INDEX idx_students_status   ON students(status);

-- =====================================================
-- END OF SCHEMA
-- =====================================================
