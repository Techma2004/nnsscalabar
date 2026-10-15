# NNSS Calabar Portal User Guide

This guide explains how to access and use the NNSS Calabar School Management System according to the permissions assigned to each account. It is written for school operators and end users, not only developers.

- **Commandant:** school-wide oversight and management-level account control.
- **Administrator (Admin):** day-to-day account, student, curriculum, and school configuration management.
- **Head of Department (HOD):** departmental oversight and result review/approval.
- **Teacher:** assigned classes, score entry, score-sheet import, and submission for approval.
- **Student:** personal dashboard, change requests, and access to approved academic results.
- **News team (editor):** writes and publishes the public Blog and Newsletter pages. See [chapter 7](#7-news-team-interface-blog-and-newsletter).

For installation, database configuration, account bootstrap, and server operation, see the main [README.md](README.md). For security rules and vulnerability reporting, see [SECURITY.md](SECURITY.md).

## 1. First sign-in: all users

### What you need

Your school-issued **User ID** and password. An account must already have been created and activated by an authorized operator. There is no public self-registration.

### Sign in

1. Open the portal address provided by the school. On a local installation, it is usually `http://localhost:5000/login.html`.
2. Enter your User ID and password.
3. Select **Sign in**.
4. The server checks your account and opens the portal appropriate to your role. You cannot choose a different role from the login screen.
5. When finished on a shared computer, use the portal's sign-out control and close the browser tab.

User IDs are normalized to uppercase during sign-in. If login fails, carefully re-enter your ID and password. Repeated failed attempts are rate-limited. If you still cannot sign in, contact the school administrator; do not create another account or ask someone to share their password.

### General account and data rules

- Never share your password or leave a signed-in session open on a shared device.
- Use only the pages and records needed for your official duties.
- Do not send student records, result sheets, passwords, or screenshots containing personal information through public chats or public issue trackers.
- Student results are not available to students until the HOD approval workflow is complete.
- If a menu item is unavailable or an action is denied, your account may not have the required role, department, or class/subject assignment. Ask the authorized administrator to review the setup.

## 2. Commandant interface

The Commandant portal is the school-wide oversight area. It is intended for the Commandant and authorized management duties, not routine teacher score entry.

### Initial setup

1. The system operator installs the application and imports the database schema. See [README.md](README.md#installation-at-a-glance).
2. The first Commandant account is created from the server using `npm run seed:commandant`. This is a one-time bootstrap operation for the initial account, not a normal portal registration form.
3. Sign in using the issued Commandant User ID and password.
4. Ask the administrator to verify school reference data—classes, arms, departments, subjects, academic session, terms, and teacher assignments—before the school starts recording live results.
5. Replace any sample/demo records with verified school records before using the figures for official decisions.

### Understand the Commandant dashboard

The dashboard can include a term selector and school-wide summaries such as:

- Student/staff headcount.
- Results pipeline: approved sheets/results, awaiting HOD review, and items sent back for correction.
- Term average and pass rate.
- Grade distribution.
- Class-sheet completion/progress, including classes with the most outstanding work.
- Top five students for the selected context.

Treat dashboard numbers as operational summaries. Before taking formal action, confirm the selected term/session and inspect the underlying records. Statistics depend on available and approved data.

### Main management areas

**School Overview**
- Review summaries by class and department.
- Use this for high-level monitoring; investigate the underlying records when a figure needs explanation.

**Result Sheets**
- Browse class/arm/subject/term sheets across the school in a read-only oversight view.
- Check which sheets are complete, awaiting review, approved, or returned.
- HODs remain responsible for their assigned department's review workflow; the Commandant overview is not a substitute for that review.

**Top Performers**
- Filter by academic term and class.
- Check that the selected term and the approved result data are appropriate before using the list.

**Students**
- Review the school-wide student register.
- Check class/arm placement and student lifecycle status. Keep withdrawn, graduated, repeating, and pending records accurate rather than deleting historical records without an approved process.

**Teachers and curriculum**
- Review staff, departments, subjects, class levels, arms, and curriculum configuration.
- Ensure teaching assignments match the real timetable and academic session.

**Classes and sessions**
- Keep academic sessions and terms aligned with the official school calendar.
- Confirm the correct current session/term before score entry begins. Avoid changing live academic configuration mid-process without coordinating with the relevant staff.

**Announcements**
- Publish announcements for the intended audience. Review the audience and wording before publishing so information is not sent to the wrong group.

**Account Management**
- The Commandant can create management-level accounts, including administrators and Commandants, as well as other supported roles.
- Create only accounts for verified staff/students. Assign each account the correct role and required department/class/arm/track details.
- Give credentials to the intended account holder privately and ask them to replace any temporary password as soon as the available account workflow allows.

### Commandant's operational checklist

Before a term opens:
1. Verify the academic session and terms.
2. Confirm class levels, arms, departments, subjects, and curriculum mappings.
3. Confirm student records and class/arm placement.
4. Confirm teacher and HOD accounts, departments, and teaching assignments.
5. Publish only relevant announcements.

During the term:
1. Monitor sheet progress and outstanding HOD reviews.
2. Follow up on returned sheets and missing entries with the responsible staff.
3. Use approved data when reviewing averages, pass rates, grade distributions, and top performers.

Before results are treated as final:
1. Confirm the correct session and term.
2. Review pending/returned sheets with the responsible HOD.
3. Verify that published student views show only approved results.
4. Ensure database backups are current and stored securely.

## 3. Administrator interface

Administrators handle routine operational setup and records. An Admin account does **not** automatically have permission to create other Admin or Commandant accounts; that management-level account creation is reserved for the Commandant.

### Initial setup

1. The Commandant creates an Admin account in Account Management, or an operator bootstraps the first administrator with `npm run seed:admin`.
2. Sign in using the issued credentials.
3. Confirm the school configuration with the Commandant before entering live data.
4. Create and verify the required staff and student accounts before asking users to sign in.

### Account Management

Use Account Management to create supported user roles:

- **Student:** unique User ID, full name, initial password, class, arm (the track is set automatically) and the **parent or guardian's name and phone number**. All are required.
- **Teacher:** unique User ID, full name, initial password, **phone number**, department, and **one or more subjects** (tick as many as the teacher takes). Then choose the classes: **all classes and arms that study the chosen subjects**, or **only specific classes** (pick subject + class + arm one by one). A subject can only be given to a class and arm that study it.
- **HOD:** unique User ID, full name, initial password, phone number and the department.
- **News team (editor):** unique User ID, full name, initial password and phone number. See [Blog and newsletter](#blog-and-newsletter-news-team).
- **Admin/Commandant:** creation of these management-level roles is restricted to the Commandant. A phone number is required.

Every account needs a phone number so the HOD, Administrator and Commandant can reach staff, or a student's parent or guardian, when a student is absent, a teacher is away, or a result needs follow-up. Numbers appear as tap-to-call links in the Teachers and Students lists and on each profile.

**If a number changes:** only the Administrator or Commandant can change it. Open the person's profile (Teachers, Students or Account Management, then *Open profile*) and press *Update contact details*. HODs can see numbers but cannot edit them.

Important account rules:
- User IDs must be 3–20 characters and use letters, numbers, underscores, or hyphens.
- Initial passwords must be at least 8 characters and should be unique and difficult to guess.
- Do not reuse one shared password for a whole class or department.
- Confirm the role and department before saving. Incorrect role assignments can expose information or prevent the user from doing their job.
- If an account is already present, check the existing record before creating a duplicate. User ID/email uniqueness is enforced.

### Student register and lifecycle

Use the student management area to review the register, search for students, and maintain valid student status. Depending on the available controls, statuses include active, pending, withdrawn, graduated, and repeating.

- Keep student class, arm, track, and admission details aligned with the official register.
- Use status changes for lifecycle events instead of casually deleting records; historical results need to remain interpretable.
- Confirm the student's identity before updating personal or parent/contact information.
- Restrict access to sensitive student details to authorized staff.

### Curriculum and school configuration

Maintain the reference data the other portals depend on:

1. **Departments:** confirm the department list and HOD ownership.
2. **Subjects:** confirm subject names and department mappings.
3. **Classes and arms:** confirm the class levels and active arms used by the school.
4. **Tracks/curriculum:** verify which subjects apply to junior, science, technical, and arts tracks.
5. **Academic sessions and terms:** confirm dates/current flags and result-lock state.
6. **Teacher assignments:** confirm which teacher is responsible for each subject/class/arm in the correct session.

Teachers can only enter results for assignments the server recognizes. If a teacher cannot see a class or subject, review the assignment and current session rather than sharing another user's account.

### Announcements and oversight

- Review the message, audience, and timing before publishing an announcement.
- Use administrative result oversight to help resolve data-entry problems, but preserve the HOD approval process.
- Avoid treating pending or returned results as final results.
- Keep a record of approved changes according to the school's internal procedure.

### Administrator handover checklist

- Verify the new user's identity and role.
- Give the user their credentials privately.
- Confirm they can sign in and see only the correct portal and records.
- Remove/deactivate access promptly when authorized staff leave or no longer require it.
- Never store passwords in spreadsheets, source files, public issues, or shared chat groups.

## 4. HOD interface

The HOD portal focuses on departmental monitoring and review of teachers' submitted results.

### Initial setup

1. The Commandant or Admin creates the HOD account and assigns the correct department.
2. Verify that the department has the correct subjects and active teacher accounts.
3. Confirm that teachers' class/arm/subject assignments correspond to the current academic session.
4. Sign in with the issued HOD credentials.

An HOD's review scope is department-related. If a teacher or sheet is missing, ask the administrator to verify the department, subject mapping, session, and assignment.

### Department dashboard, teachers and students

- **Teachers** and **Students** each have their own list showing only people in your department, with a search bar. Students in your department are those enrolled this session in any of your department's subjects.
- Click a name (or *Open profile*) to see that person's ID, contact numbers and real activity: for a teacher, their classes and the score sheets they entered; for a student, their results, subjects and requests. Nothing on a profile is placeholder data.
- **Change Requests:** students ask to change arm, or add or drop a subject. Review each one and *Accept* (the change is made straight away) or *Decline* (a reason is required and the student sees it). Dropping a subject is blocked once results exist for it this session.
- The dashboard's *Needs your attention* card lists what is waiting: results to approve, requests to decide, teachers with no phone number.

- Review department-level counts and result progress.
- Check the department's active teachers and subject coverage.
- Follow up with teachers on sheets that are incomplete, pending, or returned.
- Use student/staff information only for official departmental work.

### Review and approve results

1. Open the result review/approval area (labelled **Result Approval** in the result workflow).
2. Select the correct academic session/term and the relevant class, arm, and subject.
3. Open the teacher's submitted sheet and review the scores, totals, grades, and remarks.
4. Check that every entered score is plausible and within its component's allowed range. Confirm unusual values against the teacher's source sheet.
5. If the sheet is correct, approve the sheet. Approval allows students to see the approved results.
6. If an individual score needs correction, send it back with a clear reason. A reason is required so the teacher knows what to fix.
7. Recheck the corrected submission when it returns.

Approval is a meaningful publication step. Do not approve an entire sheet simply because the totals look plausible; confirm the entries against the official score source and the correct student roster.

### What happens after approval?

- Approved results become available in the student portal.
- When a teacher edits an approved result, the approval status resets and an audit entry is recorded. The changed result must go through review again.
- Returned or pending results should not be treated as published/final.

### HOD review checklist

- Correct academic session, term, class, arm, and subject.
- Correct student names/IDs and no unintended row shifts.
- Complete entries for every row that has been started.
- Component scores are within the allowed limits.
- Totals and grade/remarks match the system's configured scheme.
- Returned entries include a clear, actionable reason.
- The final approval action is intentional.

## 5. Teacher interface

Teachers are responsible for entering accurate results for their assigned classes, arms, and subjects and submitting them for HOD review.

### Initial setup

1. The Commandant or Admin creates the teacher account and assigns a department and subject(s).
2. Verify that class/arm/subject assignments exist for the current academic session.
3. Sign in with the issued User ID and password.
4. Confirm that the correct classes, arms, subjects, and terms appear in the portal.

A teacher can only access authorized assignments. If the expected class or subject is missing, ask the administrator to correct the assignment; do not use another teacher's credentials.

### Choose the correct score sheet

1. Open **Score Sheet**.
2. Select the assigned class, arm, subject, and academic term.
3. Confirm the roster and subject before entering data.
4. Keep the official paper sheet/register available while entering or importing scores.

The score sheet represents one subject, one class/arm, and one term. Double-check these selections before typing scores or importing a file.

### Understand the assessment scheme

The configured sheet totals 100 marks:

| Component | Maximum |
|---|---:|
| 1st Test | 15 |
| Quiz | 5 |
| Assignment | 5 |
| **First assessment subtotal** | **25** |
| 2nd Test | 5 |
| Project | 5 |
| Note | 5 |
| **Second assessment subtotal** | **15** |
| Exam | 60 |
| **Term total** | **100** |

The six continuous-assessment components total 40, and the examination is 60. The application calculates totals, grades, and remarks from the configured scheme; do not manually change the total to force a desired grade. If the school's approved grading policy changes, have an authorized maintainer update and verify the single source of truth in the application.

### Option A — Score Sheet (whole class)

1. Open the **Score Sheet** grid for the correct assignment and term.
2. Enter each student's score in the appropriate component column.
3. Check the student's name/ID before entering each row.
4. Review the live totals and grades.
5. Draft changes may autosave, but confirm the save status shown by the portal before leaving the page.
6. Review every row before submitting the sheet for HOD approval.

A blank row is skipped. Once a row is started, every required component must be entered; enter `0` for a genuine zero rather than leaving a component blank. Every score must be within its allowed range. Do not use blanks to mean zero.

### Option B — Manual Entry (one student)

Use **Manual Entry** when correcting or entering an individual student's score:

1. Select the correct assignment and term.
2. Select or identify the intended student.
3. Enter the score components, checking each value against the official source.
4. Save/submit as directed by the portal.
5. Ensure the result is in the appropriate pending/review state.

A saved score is not automatically published to the student. It must follow the HOD review process.

### Option C — Excel import/export

1. Download the score-sheet template from the portal, or use the repository's generated `score-sheet-template.xlsx` when provided by the administrator.
2. Fill the template without changing its expected column headings or student identifiers.
3. Keep the workbook for one matching class/arm/subject/term context.
4. Export or save the workbook in the supported Excel format.
5. Use the portal's import control and review the returned validation/matching results.
6. Correct all warnings before saving/submitting.

If the template needs to be regenerated on the server, the operator can run `npm run build:template` from `backend/`. Do not upload a workbook containing another class's scores.

### Option D — AI Scanner (optional OCR)

The scanner reads blue or black pen as well as print: it converts the photo using the darkest colour channel, and retries with other settings when the first read is incomplete. Rows it cannot read fully are left blank for you to type in. Always check the review table before saving.

The **AI Scanner** reads text from a photo or PDF of a paper score sheet using local Tesseract OCR. It may misread handwriting, printed digits, or names.

1. Open **AI Scanner** and confirm the scanner status says it is available.
2. Select a clear, legible photo or supported PDF of the correct score sheet.
3. Run the scan.
4. Review each matched student and each extracted score against the paper original.
5. Correct misread names or values. Pay particular attention to similar student names, digits, blanks, and column alignment.
6. Tick the explicit confirmation control and submit only after checking the entire proposed import.

OCR output is a draft. It does not publish or approve results automatically. If scanning is unavailable or uncertain, use Manual Entry or Excel import. Do not photograph or upload unrelated personal information.

### Submit and follow up

- Submit the completed sheet to the HOD approval workflow.
- Track its status and respond to any returned entries.
- When an HOD returns a score, read the reason, correct the value, and resubmit as appropriate.
- If an approved score is edited later, it must be reviewed again.
- Keep the source score sheet according to the school's record-retention procedure.

## 6. Student interface

The student portal is for viewing your own school information and approved academic results.

### Initial setup

1. The school administrator creates your student account and assigns your class, arm, and track.
2. Receive your User ID and temporary/initial password privately from the school.
3. Open the portal address supplied by the school and sign in.
4. Check that your displayed name and class/arm are correct. Report errors to the school office/administrator.

Students cannot create accounts or view another student's private record.

### Change Requests (arm or subject)

Open **Change Requests**, choose *Change my arm*, *Add a subject* or *Drop a subject*, give a short reason, and send. Your HOD accepts or declines; you can see the answer (and the reason for a decline) on the same page and on your dashboard. You can withdraw a request that is still waiting.

### Dashboard and profile

- Review your account and placement information.
- Read announcements available to your account/audience.
- Use profile information for your own account only.
- Tell the school administrator if your name, class, arm, or other displayed information is incorrect; do not attempt to access another account to compare records.

### View results

1. Open the results area and select the correct academic session/term if prompted.
2. Open the published result or report card.
3. Check each subject and score carefully.
4. If a result is missing, first confirm the correct term. Results remain hidden from students until the HOD approves them.
5. If a published result appears incorrect, contact the subject teacher or school office through the school's normal process. Do not ask for another student's login.

### Print a report card

Where the report-card print view is available:

1. Open the relevant approved term result.
2. Review the displayed subjects, totals, grades, and any optional summary figures.
3. Use the print control or the browser's print command.
4. Choose the correct printer or **Save to PDF**.
5. Keep the printed/PDF report private because it contains personal academic information.

Some report-card statistics, such as averages or position, may be optional and may not appear when there is insufficient approved data. Their absence does not necessarily mean the report card failed to load.

## 7. News team interface (Blog and Newsletter)

The public **Blog** (`blog.html`) and **Newsletter** (`newsletter.html`) pages are edited from the portal, in one screen, by the school's article or news team. **We recommend giving this job to the article/news team** rather than to an administrator. A news-team account can only edit posts and its own profile; it cannot see students, results, accounts or any other part of the portal.

### A. Set up a news-team account (Commandant or Administrator, once per person)

1. Make sure the database has been updated for this feature: a fresh install already has it; an existing database needs `database/006_news_team_requests_contacts.sql` run once (see the README, "Existing database and roster tools"), then restart the server.
2. Sign in as the Commandant or an Administrator.
3. Open **Account Management** and press **Create account**.
4. Set **Role** to **News team (blog & newsletter)**.
5. Fill in **User ID** (for example `NEWS01`), **Full name**, **Initial password** (at least 8 characters) and **Phone number** (required). Email is optional.
6. Press **Create account**.
7. Give the person their User ID and password privately. Ask them to change the password after the first sign-in.

Create one account per team member so that each post shows who last edited it. Do not share one login.

### B. Sign in (news team)

1. Open the portal sign-in page, usually `http://localhost:5000/login.html` on a local install, or the address the school gives you.
2. Enter your User ID and password and press **Sign in**.
3. You land on a short dashboard with three menu items: **Dashboard**, **Blog & Newsletter** and **My Profile**.
4. To change your password, open **My Profile**, use **Change password**, and sign in again with the new one.
5. If you forget the password, ask an Administrator or the Commandant to use **Reset password** next to your name in Account Management.

### C. Write a new post

1. Open **Blog & Newsletter** and press **New post**.
2. **Show on:** choose *Blog page* or *Newsletter page*.
3. **Date shown:** the date visitors see on the post (today by default).
4. **Title** and **Text:** type the post. Leave a blank line between paragraphs. Formatting symbols are not needed; the text is shown exactly as written.
5. **Picture (optional):** pick one of the school photos in the grid, or press **Upload a picture** to add your own (PNG, JPEG or WebP, up to 2.5 MB). Choose *No picture* to leave it out.
6. **When saved:** *Publish now* puts it on the public page immediately; *Keep as a draft (hidden)* saves it so you can finish later.
7. Press **Save post**. Open **View blog** or **View newsletter** at the top of the screen to see it as the public sees it.

### D. Edit, hide or delete a post

- **Edit:** press **Edit** on the post's row, change anything, then **Save changes**.
- **Unpublish / Publish:** hides a post from the public page without losing it, or puts it back.
- **Delete (bin icon):** removes the post permanently after you confirm. This cannot be undone; use *Unpublish* if you might want it back.
- Use the **All / Blog / Newsletter** tabs and the search box to find a post. Each row shows when it was last edited and by whom.

### E. Good practice

- Use drafts for anything that needs a second person to read it first.
- Do not put students' names, photos, results or contact details in public posts without the school's permission.
- Keep pictures small and relevant; uploads over 2.5 MB are refused.
- Uploaded pictures are stored in the `frontend/uploads/` folder on the server. It is not part of the git repository, so **include it in server backups** together with the database.
- The first time the update is installed, the articles that used to be fixed in the web pages are copied in as ordinary posts. Review and tidy them once.

### F. If something does not work

| Problem | What to do |
|---|---|
| The role is missing from the Create account form | The database update (migration 006) has not been run, or the server was not restarted. |
| "Access denied" or a blank menu | The account is not a news-team account, or has been deactivated. Ask an Administrator. |
| A new post is not on the public page | Check its status is *Published*, then refresh the public page. |
| Picture upload fails | Use a PNG, JPEG or WebP file under 2.5 MB. |
| Cannot sign in | Re-check the User ID and password; ask an Administrator to reset the password. |

## Class Score Sheets (HOD, Administrator, Commandant)

This screen lists one score sheet per class and subject for the chosen term and how far each has got: not started, in progress, waiting for the HOD, or approved. Open a sheet to read exactly what the teacher entered. *Preview & download* shows the sheet in the browser first; the Excel file downloads only if you press *Download Excel* in the preview.

## 8. Understanding result statuses

| Status / situation | Meaning | What to do |
|---|---|---|
| Draft / saved | Teacher is entering or updating data; not yet approved | Teacher reviews and submits when complete |
| Pending HOD review | Submitted and awaiting departmental review | HOD checks the sheet |
| Returned | HOD has asked for one or more corrections | Teacher reads the reason, corrects, and resubmits |
| Approved | HOD has approved the result | Student can view the approved result |
| Missing from student view | Often not approved yet, or the wrong term/session is selected | Confirm the term and ask the teacher/HOD if needed |
| OCR unavailable | Optional scanner dependencies/configuration are not ready | Use Score Sheet, Manual Entry, or Excel import |

The exact status labels shown on screen can vary with the specific workflow view. The key distinction is that **saved or pending data is not the same as an approved, student-visible result**.

## 9. Support and common questions

### I forgot my password. What should I do?

Contact the school administrator using the school's approved channel. Administrators should follow the authorized account-recovery procedure. Do not send passwords in public messages or post account details in a GitHub issue.

### I cannot see a class, subject, student, or department.

Ask the administrator to verify your role, department, active status, academic session, curriculum mapping, and class/arm/subject assignment. Access is enforced by the server and cannot be granted merely by changing a URL.

### My result has not appeared.

Check the correct session and term. Ask the teacher whether the sheet was submitted, then ask the HOD whether it was approved or returned. Only approved results are available to students.

### OCR produced a wrong score or student match.

Do not submit the result until you have checked it against the original paper. Correct it manually or switch to Manual Entry/Excel import. OCR is a helper, not the authoritative record.

### Something appears broken or I see an access-denied message.

Note the page and action, the time, and the non-sensitive error text. Contact the authorized school administrator. Do not send passwords, session cookies, real student records, or full database dumps with a support request.

## 10. Privacy and safe use

- Student information and results are confidential school records.
- Use the portal only for assigned school duties.
- Sign out from shared devices.
- Do not share screenshots or exports outside approved school channels.
- Do not use real student data on an unencrypted HTTP demonstration server.
- Report suspected account compromise or unintended data exposure promptly to the authorized school administrator and follow [SECURITY.md](SECURITY.md) for security issues.
