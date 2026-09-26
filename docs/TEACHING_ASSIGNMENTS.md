# Teaching Assignment Workflow

## Purpose

Teaching assignments are now explicit per teacher and per academic session. A teacher may have one subject/class assignment or many. The system no longer needs a teacher to be treated as responsible for every curriculum class simply because the subject exists in the curriculum.

## Roles

- **Administrator / Commandant** — can configure assignments for any teacher.
- **Head of Department (HOD)** — can configure assignments only for teachers in the HOD's department.
- **Teacher** — can use their existing teaching assignments for score entry; they cannot change their own assignments.

## Data model

The existing tables remain the source of truth:

- `teacher_subjects` — subjects associated with a teacher.
- `teacher_class_assignments` — concrete subject + class level + arm assignments for an academic session.
- `academic_sessions.is_current` — identifies the session edited by the assignment workspace.

No new assignment tables are required.

## API

`backend/routes/assignments.js` provides:

- `GET /api/assignments/meta` — teachers, active subjects, classes, arms, and current session.
- `GET /api/assignments/teacher/:teacherId` — current assignments for one teacher.
- `PUT /api/assignments/teacher/:teacherId` — replaces that teacher's subjects and current-session assignments atomically.

The update endpoint validates:

1. teacher existence;
2. HOD department scope;
3. active subjects;
4. curriculum compatibility for the selected class/arm/subject;
5. current academic session;
6. audit logging.

Historical assignments from previous sessions are not deleted.

## UI

`frontend/assignments.js` adds **Teaching Assignments** to the management/HOD portal navigation. The workflow is:

1. Create the teacher account.
2. Open **Teaching Assignments**.
3. Select the teacher.
4. Add one or more subjects.
5. Add one or more class/arm combinations.
6. Save.

Saving replaces only the teacher's assignments for the current session. Existing results remain intact.

## Why this design

The database already contained the correct many-to-many structures, so a new schema was unnecessary. The migration adds a small role-aware API and a focused UI around those tables instead of introducing a larger scheduling subsystem.
