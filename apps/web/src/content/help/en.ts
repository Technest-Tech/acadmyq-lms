import type { HelpContent } from "./types";

/**
 * The help's English words — the twin of `ar.ts`, topic for topic and task for task (a test keeps
 * them in step). On-screen names sit between double brackets exactly as the English interface
 * writes them, and are checked against the English message catalogue.
 */
const en: HelpContent = {
  dashboard: {
    title: "Dashboard",
    summary:
      "The first page you see after signing in. It shows what needs you today: today's lessons, lessons nobody has recorded yet, and the academy's key numbers.",
    tasks: {
      overview: {
        title: "How do I read the dashboard?",
        steps: [
          "The cards at the top show today's key numbers: students, today's lessons, and lessons not recorded yet.",
          "The lists below them show what is waiting on you, such as unrecorded lessons and trial lessons.",
          "To jump to any page or student, use the search at the top of the screen.",
        ],
        note: "The numbers update by themselves from the team's work. Nobody types them in.",
      },
      overdue: {
        title: "What are “held-up lessons” and how do I clear them?",
        steps: [
          "A held-up lesson ended hours ago and still has no outcome recorded.",
          "Open the [[Attendance]] page, then the [[Held-up lessons]] tab.",
          "Press [[Record]] beside each lesson, pick its outcome, then [[Save]].",
        ],
        note: "A lesson with no outcome is not billed to the student and not paid to the teacher.",
      },
      enter: {
        title: "How do I enter my lesson from here?",
        steps: [
          "The [[Today's lessons]] card lists your lessons in time order.",
          "The [[Enter]] button opens ten minutes before the lesson. Press it to open the meeting link.",
          "After the lesson, open the [[Attendance]] page, record the outcome and write the report.",
        ],
        note: "The time you press Enter is recorded and is what your punctuality is measured by. If the button does not work, ask the office to add your meeting link.",
      },
      reports: {
        title: "Where do I find my old reports?",
        steps: [
          "The [[My latest reports]] card shows what you wrote last. Press one to open it in full.",
          "For all of them press [[Full reports log]], or open [[Reports log]] from the menu.",
          "If an alert shows lessons without a report, press it to write them.",
        ],
      },
    },
    tips: ["Start your day here: what this page shows is what needs doing today."],
  },

  notifications: {
    title: "Notifications",
    summary:
      "The page is split by what each alert asks of you: what waits for your decision first, then what to follow up, then a log of what happened.",
    tasks: {
      tabs: {
        title: "What does each section mean?",
        steps: [
          "[[Needs your decision]]: teachers asking to cancel a lesson or make it free, money not collected, and lessons taken with no package.",
          "[[To follow up]]: reports not written, grouped per teacher, and packages nearly done or finished.",
          "[[Log]]: attended lessons, cancelled group lessons and the requests you decided. For reading only.",
          "Once you have read an alert, press [[Mark read]] to move it under \"Already seen\" and off the counter.",
        ],
      },
      approve: {
        title: "How do I approve or reject a cancellation request?",
        steps: [
          "Open [[Needs your decision]].",
          "Press [[Approve]] on the request.",
          "Answer [[Charge the student]] with yes or no, choose how much the teacher is paid, and write the [[Reason]].",
          "Press [[Apply]]. Or press [[Reject]] to leave the lesson as it is.",
        ],
        note: "The reason you write appears on the parent's bill.",
      },
    },
  },

  students: {
    title: "Students",
    summary:
      "Every student in the academy. From here you add a student, open their file, and set their teacher, timetable and subscription.",
    tasks: {
      add: {
        title: "How do I add a new student?",
        steps: [
          "Press [[New student]] at the top of the page.",
          "Choose how they start: [[Active student]] or [[Trial student]].",
          "Type the [[Full name]], then pick the [[Guardian]] from the list, or press [[New parent]] and type their name and WhatsApp number.",
          "Press [[Add a teacher]] and pick the teacher and the subject. This step is optional and can wait.",
          "Set how they are billed: the price and start date, or the group and subscription if your academy teaches groups.",
          "Press [[Add student]].",
        ],
        note: "This form does not create the lesson timetable. After saving, open the student's file and add their weekly timetable.",
      },
      timetable: {
        title: "How do I set a student's weekly timetable?",
        steps: [
          "Press [[Open]] beside the student.",
          "Open the [[Schedule]] tab.",
          "Press [[Add Slot]] and choose the day, the time and the lesson length. Repeat for each day.",
          "Press [[Save schedule]].",
        ],
        note: "The student needs a teacher first (the Teachers tab). Saving creates the coming lessons by itself and never changes past ones.",
      },
      activate: {
        title: "How do I turn a trial student into an active one?",
        steps: [
          "On the trial student's row, press [[Add trial or activate]].",
          "Press [[Activate]].",
          "On the schedule step, set the teacher and the times, then press [[Save & continue]].",
          "On the pricing step, enter the price, then press [[Complete Enrollment]].",
        ],
      },
      teachers: {
        title: "How do I change a student's teacher?",
        steps: [
          "Press [[Open]] beside the student.",
          "Open the [[Teachers]] tab.",
          "Press [[Replace a teacher]] to move the student to another teacher, or [[Edit teachers]] to add a teacher for another subject.",
          "Save the change.",
        ],
        note: "A student can have more than one teacher: one per subject.",
      },
      deactivate: {
        title: "How do I stop or delete a student?",
        steps: [
          "Press [[Open]] beside the student.",
          "Open the [[Settings]] tab.",
          "Press [[Deactivate student]] to stop them and keep their history, or [[Delete student]] to remove them.",
        ],
        note: "A deactivated student can be switched back on from the same tab.",
      },
      mine: {
        title: "How do I see my students and their lessons?",
        steps: [
          "This list shows your own students only.",
          "Type a student's name in the search box to find them quickly.",
          "Press [[View]] beside a student to see their lessons.",
        ],
      },
    },
    tips: [
      "The tiles above the list work as filters: press [[Active]] or [[Trials]] to see only that group.",
      "Search works by the student's name, the parent's name or a phone number.",
    ],
  },

  guardians: {
    title: "Parents",
    summary:
      "Every family and who pays for it. The parent is the one the bill is addressed to, with their children listed under them.",
    tasks: {
      add: {
        title: "How do I add a parent?",
        steps: [
          "Press [[New parent]].",
          "Type the [[Full name]] and the [[WhatsApp phone]], and choose the [[Country]] and [[Currency]].",
          "Press [[Create parent]].",
          "The family page opens straight away. Add the first child with [[Add student]].",
        ],
      },
      child: {
        title: "How do I add a child to an existing family?",
        steps: [
          "Open the family from the list.",
          "Press [[Add student]].",
          "Choose [[New student]] and fill in their details, or [[Existing student]] then [[Move to this family]].",
        ],
        note: "Moving an existing student brings what they owe with them.",
      },
      portal: {
        title: "How do I send a parent the link to their page?",
        steps: [
          "Open the family from the list.",
          "On the [[Parent page]] card, press [[Send on WhatsApp]].",
          "Or press [[Copy]] and send the link yourself.",
        ],
        note: "The link belongs to the family and needs no account or password. If it reaches the wrong person, change the link and the old one stops working.",
      },
      pause: {
        title: "How do I pause a family for a while?",
        steps: [
          "Open the family from the list.",
          "Press [[Pause the family]].",
          "To bring them back, press [[Resume]].",
        ],
        note: "Pausing stops the children's timetables and their coming lessons until you resume.",
      },
    },
  },

  teachers: {
    title: "Teachers",
    summary: "The teachers' roster: their details, pay, lesson links and logins.",
    tasks: {
      add: {
        title: "How do I add a teacher?",
        steps: [
          "Press [[New teacher]].",
          "Type the [[Full name]] and [[WhatsApp number]], and choose the [[Specialization]].",
          "Choose the [[Pay type]]: [[Per hour]], [[Per student]] or [[Fixed monthly]], and type the rate.",
          "Add the [[Meeting link]] the teacher gives their lessons on.",
          "Tick [[Create a login for this teacher]] and type an email and a password of at least 8 characters.",
          "Press [[Create teacher]].",
        ],
      },
      pay: {
        title: "How do I change a teacher's pay?",
        steps: [
          "Open the teacher from the list.",
          "Open the [[Salary]] tab.",
          "Change the rate, then press [[Save pay]].",
          "To apply the new rate to lessons already recorded, press [[Recalculate]].",
        ],
        note: "Each lesson's pay is fixed the moment its attendance is recorded. Pay is per hour: a half-hour lesson earns half the rate.",
      },
      login: {
        title: "How do I give a teacher a login?",
        steps: [
          "Open the teacher from the list.",
          "On the [[Profile]] tab, scroll to the [[Account & login]] card.",
          "Type the email and password, then press [[Create login]].",
          "Send the teacher the email and password to sign in with.",
        ],
      },
      link: {
        title: "How do I add or change a teacher's meeting link?",
        steps: [
          "Open the teacher from the list.",
          "On the [[Profile]] tab, fill in the [[Meeting link]].",
          "Press [[Save changes]].",
        ],
        note: "Without a link, the teacher's Enter button does not work.",
      },
    },
    tips: ["A teacher who still has students cannot be deactivated until those students are given to another teacher."],
  },

  "teacher-performance": {
    title: "Teacher performance",
    summary: "Each teacher's evaluation for the month, made of four parts: lesson quality, reports, entering lessons and conduct.",
    tasks: {
      read: {
        title: "How do I read a teacher's evaluation?",
        steps: [
          "Open [[Teacher Performance]] from the menu. Each teacher is a card with the month's total out of 100.",
          "Under the total are the four parts it is made of: lesson quality, reports, entering lessons and conduct.",
          "Press [[Details]] on a card to see the lessons, lesson ratings and conduct notes behind the number.",
          "Use the arrows beside the month to open an earlier month.",
        ],
        note: "A part with nothing to measure, such as a teacher no one has visited yet, is left out of the total.",
      },
      visit: {
        title: "How do I rate a lesson I sat in?",
        steps: [
          "Press [[Rate a lesson]] on the teacher's card.",
          "Pick the lesson you sat in, then give each item its stars out of five.",
          "Write what went well and what to work on.",
          "Press [[Save rating]]. The teacher's lesson quality for the month is the average of these ratings.",
        ],
      },
      note: {
        title: "How do I record an absence, an apology or a rule not kept?",
        steps: [
          "Press [[Conduct note]] on the teacher's card.",
          "Choose what happened: [[Absence]], [[Apology]] or [[Rule not kept]]. Each one shows the points it takes off.",
          "Pick the lesson it is about, or leave it and set the date.",
          "Write the details and press [[Save note]].",
        ],
        note: "A lesson the teacher cancelled waits in their details until you record it as an absence or an apology.",
      },
      settings: {
        title: "How do I change how the evaluation is calculated?",
        steps: [
          "Press [[Evaluation settings]] at the top of the page.",
          "Set the share of each of the four parts. They must add up to 100.",
          "Set the points each kind of note takes off, the items a lesson is rated on, and the academy's rules.",
          "Press [[Save]].",
        ],
      },
    },
  },

  staff: {
    title: "Team & permissions",
    summary:
      "Everyone on your team who signs in, and what each can do. Teachers are added on the Teachers page, not here.",
    tasks: {
      add: {
        title: "How do I add an employee and give them a login?",
        steps: [
          "Press [[Add member]].",
          "Type the [[Full name]].",
          "Type the sign-in email and a password of at least 8 characters.",
          "Choose the [[Role]]: [[View only]], [[Customer service]], [[Supervisor]], [[Accountant]] or [[Manager]].",
          "Press [[Add member]] at the bottom of the form to save.",
        ],
        note: "You are only offered roles that hold no more than you do.",
      },
      change: {
        title: "How do I change an employee's role or stop their login?",
        steps: [
          "Open the member's page from the list.",
          "On the [[Account & login]] card, change the [[Role]], or switch off [[Login enabled]] to stop them signing in.",
          "Press [[Save changes]].",
        ],
      },
      role: {
        title: "How do I create a role with its own permissions?",
        steps: [
          "Open the [[Roles]] tab.",
          "Press [[New role]].",
          "Type the [[Role name]] and tick the permissions you want.",
          "Press [[Save]].",
          "Give the new role to the employee from their page.",
        ],
        note: "You can also edit a built-in role. The change applies to your academy only, and resetting it puts it back as it was.",
      },
    },
  },

  calendar: {
    title: "Calendar",
    summary: "Every lesson on one calendar: by month, week or day, or as a list.",
    tasks: {
      views: {
        title: "How do I move around the calendar?",
        steps: [
          "Choose the view: [[Month]], [[Week]], [[Day]] or [[List]].",
          "Move between periods with [[Previous]] and [[Next]]. [[Today]] brings you back to today.",
          "Press any lesson to see its details.",
        ],
      },
      timetable: {
        title: "How do I create a weekly timetable for a student?",
        steps: [
          "Open the [[Student timetables]] tab.",
          "Press [[Add timetable]].",
          "Choose the [[Student]] and the [[Teacher]].",
          "Press [[Add slot]] for each day, and set the start time and the minutes.",
          "Set [[Starts from]], then press the create button.",
        ],
        note: "The system creates the lessons by itself from the start date. If the lesson length differs from the length the student is priced on, you get a warning.",
      },
      oneoff: {
        title: "How do I add a single lesson outside the timetable?",
        steps: [
          "Press [[New session]] above the calendar, or press an empty slot in the week or day view.",
          "Choose the student, the teacher, the time and the length.",
          "Save the lesson.",
        ],
      },
      move: {
        title: "How do I move a lesson to another time?",
        steps: [
          "Press the lesson on the calendar.",
          "Press [[Reschedule]].",
          "Set the [[New time]], then press [[Reschedule]].",
        ],
        note: "This moves that one lesson and leaves the rest of the timetable alone. You can also drag the lesson to its new time.",
      },
      cancel: {
        title: "How do I cancel a lesson?",
        steps: [
          "Press the lesson on the calendar.",
          "Press [[Cancel lesson]].",
          "Say who cancelled: [[Cancel (by teacher)]] or [[Cancel (by student)]].",
        ],
        note: "A cancelled lesson is not billed.",
      },
    },
  },

  attendance: {
    title: "Attendance",
    summary:
      "Where each lesson's outcome is recorded and its report written. What is recorded here is what reaches the student's bill and the teacher's pay.",
    tasks: {
      mark: {
        title: "How do I record a lesson's attendance?",
        steps: [
          "Press [[Record]] beside the lesson.",
          "Pick the outcome: [[Attended]] if the lesson took place.",
          "Write the [[Session report]].",
          "Press [[Save]].",
        ],
        note: "Saving a report without picking an outcome leaves the lesson unrecorded.",
      },
      sheet: {
        title: "How do I take a group's attendance?",
        steps: [
          "Open the [[Group classes]] tab.",
          "Press [[Take attendance]] on the group's lesson.",
          "Everyone starts as [[Present]]. Change only those who were absent or late.",
          "Fill in [[What was taught]] and [[Homework]].",
          "Press [[Save attendance]].",
        ],
      },
      overdue: {
        title: "What are “held-up lessons”?",
        steps: [
          "Open the [[Held-up lessons]] tab.",
          "It lists every lesson that ended hours ago with no outcome, whatever its date.",
          "Press [[Record]] and record each one.",
        ],
        note: "A lesson stays here until it is recorded. While it is held up, it is in no bill and no salary.",
      },
      cancel: {
        title: "How do I cancel a lesson or make it free?",
        steps: [
          "Press [[Record]] beside the lesson.",
          "Pick [[Cancelled (teacher)]], [[Cancelled (student)]] or [[Free]].",
          "Say whether the student is charged and how much the teacher is paid, and write the reason.",
          "Press [[Apply]].",
        ],
      },
      request: {
        title: "How do I ask to cancel a lesson or make it free?",
        steps: [
          "Press [[Record]] beside the lesson.",
          "Pick [[Cancelled (teacher)]], [[Cancelled (student)]] or [[Free]].",
          "Press [[Save]].",
          "Your request goes to the office, and the lesson stays scheduled until they approve it.",
        ],
      },
      add: {
        title: "How do I add a lesson that was not on the timetable?",
        steps: [
          "Press [[Add class]].",
          "Choose the student, and set the date, the time and the length.",
          "Choose the [[Status]]: [[Attended]] for a lesson that took place, or [[Scheduled]] for one still to come.",
          "Press [[Add class]] at the bottom of the form to save.",
        ],
      },
      undo: {
        title: "I recorded the wrong outcome. How do I undo it?",
        steps: [
          "Press [[Undo]] on the lesson's row.",
          "The lesson goes back to waiting, as if it had never been recorded.",
          "Record the right outcome.",
        ],
        note: "Undoing takes the lesson off the bill and out of the teacher's pay until it is recorded again.",
      },
    },
    tips: [
      "Choose [[Day]], [[Week]] or [[Month]] to see more than one day's lessons.",
      "A teacher cannot change the outcome of a lesson the office recorded, but can still write its report.",
    ],
  },

  "lesson-reports": {
    title: "Reports log",
    summary: "Every private lesson report in one place: find an old report, read it in full, edit it.",
    tasks: {
      find: {
        title: "How do I find an old report?",
        steps: [
          "Open [[Reports log]] from the menu. Reports run newest first, grouped by month.",
          "Type the student's name or a word from the report in the search, or pick the student and a period such as [[Last month]].",
          "Press a report to open it in full. [[Older]] and [[Newer]] move you between lessons.",
          "To correct something press [[Edit report]].",
        ],
        note: "A lesson whose bill is closed can no longer have its report edited.",
      },
      missing: {
        title: "How do I see the lessons I haven't reported?",
        steps: [
          "Open the [[Lessons without a report]] tab. The number beside it is how many taught lessons still wait for a report.",
          "Press [[Write report]] beside the lesson, write it and save.",
        ],
      },
    },
  },

  groups: {
    title: "Groups",
    summary: "Group classes: one teacher and several students, with a timetable and an attendance sheet per group.",
    tasks: {
      create: {
        title: "How do I create a group?",
        steps: [
          "Press [[New group]].",
          "Type the [[Group name]] and choose the [[Teacher]].",
          "Choose where it meets: [[Online]] or [[In person]].",
          "Set the [[Start date]] and add the [[Weekly times]].",
          "Set what each student pays and what the teacher earns.",
          "Press [[Create group]].",
        ],
        note: "The group's lessons are created by themselves from the start date.",
      },
      members: {
        title: "How do I add students to a group?",
        steps: [
          "Open the group.",
          "Open the [[Members]] tab.",
          "Press [[Add students]].",
          "Pick the students and set [[Joins on]].",
          "Confirm.",
        ],
        note: "Lessons before the join date never count the student absent.",
      },
      sheet: {
        title: "How do I take attendance for a group's lesson?",
        steps: [
          "Open the group, then the [[Lessons]] tab.",
          "Press [[Take attendance]] on the lesson.",
          "Everyone starts as [[Present]]. Change only those who were absent or late.",
          "Fill in [[What was taught]] and [[Homework]].",
          "Press [[Save attendance]].",
        ],
      },
      lesson: {
        title: "How do I move or cancel a group's lesson?",
        steps: [
          "On the [[Lessons]] tab, press [[More]] on the lesson.",
          "Choose [[Move]] to change its time, [[Substitute teacher]] if the teacher is away, or [[Cancel lesson]].",
          "For a make-up class, press [[Extra lesson]].",
        ],
        note: "Cancelling cancels the lesson for every student in the group.",
      },
      collect: {
        title: "How do I collect a student's group payment?",
        steps: [
          "Open the group, then the [[Accounts]] tab.",
          "Press [[Collect]] on the student's row.",
          "Type the amount received and choose the [[Payment method]].",
          "Press [[Record payment]]. A receipt is issued that you can send on WhatsApp.",
        ],
      },
    },
  },

  trials: {
    title: "Free Trials",
    summary: "Trial lessons: today's, the ones waiting for a decision, the upcoming ones, and the whole record.",
    tasks: {
      book: {
        title: "How do I book a trial lesson?",
        steps: [
          "Press [[Add trial]].",
          "Choose [[New person]] and type their name and WhatsApp number, or [[Existing student]].",
          "Choose the [[Teacher]], [[Date]], [[Time]] and [[Duration]].",
          "Press [[Book trial]].",
        ],
      },
      decide: {
        title: "How do I record how a trial went?",
        steps: [
          "Once the trial's time has started, its row shows [[Attended]] and [[No-show]].",
          "Press what actually happened.",
          "Made a mistake? Press [[Undo]].",
        ],
        note: "Trials that ended with no decision are counted on the [[Need a decision]] card at the top — press it to list them all.",
      },
      convert: {
        title: "How do I turn a trial into a student?",
        steps: [
          "On the row of a trial the person attended, press [[Convert to student]].",
          "Complete the student's and the parent's details.",
          "Save. The student now appears on the Students page.",
        ],
      },
    },
  },

  "student-reports": {
    title: "Student Reports",
    summary: "The monthly report on a student's progress: the teacher writes it and sends it to the office for review.",
    tasks: {
      write: {
        title: "How do I write a monthly report?",
        steps: [
          "Under [[New report]], choose the [[Student]] and the [[Month]].",
          "Write the [[Title]] and the [[Report]]. [[Insert outline]] gives you a ready structure.",
          "Press [[Send for review]].",
        ],
        note: "One report per student per month.",
      },
      revise: {
        title: "My report was rejected. What now?",
        steps: [
          "Under [[Your reports]], open the rejected report and read the office's note.",
          "Press [[Revise & resend]].",
        ],
      },
    },
  },

  "report-reviews": {
    title: "Student Report Reviews",
    summary: "Review the monthly reports teachers send before they are approved.",
    tasks: {
      review: {
        title: "How do I review a report?",
        steps: [
          "Read the report.",
          "Press [[Approve]] or [[Reject]]. You can add a note the teacher will see.",
        ],
      },
      bulk: {
        title: "How do I approve several reports at once?",
        steps: [
          "Tick the reports, or use the button that selects every pending report.",
          "Press [[Approve selected]] or [[Reject selected]].",
        ],
      },
    },
  },

  certificates: {
    title: "Certificates",
    summary: "Certificates of achievement: pick a design, write the wording, and download for one student or a whole class.",
    tasks: {
      design: {
        title: "How do I set up the certificate design?",
        steps: [
          "Pick a design from the gallery.",
          "Change the wording and the branding on the tabs.",
          "Press [[Save template]].",
        ],
      },
      one: {
        title: "How do I issue a certificate for one student?",
        steps: [
          "Choose [[One certificate]].",
          "Type the student's name.",
          "Press [[Download PDF]] or [[PNG image]].",
        ],
      },
      class: {
        title: "How do I issue certificates for a whole class?",
        steps: [
          "Choose [[Whole class]].",
          "Add the students' names.",
          "Press the create button. They all download as one PDF.",
        ],
        note: "Only the template is saved. The names of who received a certificate are not kept.",
      },
    },
  },

  invoices: {
    title: "Invoices",
    summary:
      "The academy's bills. The monthly bill builds itself from recorded lessons, and you can make a bill by hand for any other amount.",
    tasks: {
      read: {
        title: "Where do the bills come from?",
        steps: [
          "The [[Automatic]] tab: one bill per family per month, its lines being the lessons recorded as attended.",
          "Choose the year and month to see another month.",
          "Press any row to open the bill and see its lessons.",
          "The [[Manual bills]] tab: bills you created yourself.",
        ],
        note: "Cancelled and free lessons appear on the bill with no charge.",
      },
      pay: {
        title: "How do I record that a bill was paid?",
        steps: [
          "Open the bill and press [[Mark paid]].",
          "Choose the [[Payment method]].",
          "Leave [[Amount received]] empty for the full amount, or type what was paid if it is part.",
          "Press [[Confirm]].",
        ],
        note: "If your academy works with receipts, the button opens the collect window and issues a numbered receipt.",
      },
      send: {
        title: "How do I send a bill to the parent?",
        steps: [
          "Open the bill.",
          "Press [[Send WhatsApp link]].",
          "Press [[Open in WhatsApp]], or [[Copy message]] and send it yourself.",
        ],
        note: "The parent opens the link, sees the bill and pays from it.",
      },
      custom: {
        title: "How do I create a bill for an amount of my own?",
        steps: [
          "Open the [[Manual bills]] tab and press [[New bill]].",
          "Choose who the bill is for: [[Student]], [[Guardian]] or [[Type a name]].",
          "Type the [[Amount]] and the [[Description]].",
          "Press [[Create payment link]].",
          "Send the link with [[Send on WhatsApp]].",
        ],
        note: "A hand-made bill with nothing paid on it can be deleted from its row's menu.",
      },
      close: {
        title: "When do I close the period?",
        steps: [
          "The system closes last month's bills by itself on the 2nd of each month.",
          "To close earlier, press [[Close period]].",
        ],
        note: "Closing cannot be undone: after it, no lessons are added to those bills.",
      },
    },
  },

  packages: {
    title: "Packages",
    summary:
      "Blocks of hours sold up front. Every lesson takes its length off the block, and when the block runs out it closes itself and its bill goes out.",
    tasks: {
      pages: {
        title: "What is the difference between open and due?",
        steps: [
          "[[Open packages]]: every student studying now — what they have left, their next lesson, and whether the package is paid.",
          "Press a card such as [[Running low]] or [[Ran out, not renewed]] to see only those students.",
          "[[Due packages]]: every package with money still owed, oldest first. What was paid is on the same page's Paid tab.",
        ],
      },
      open: {
        title: "How do I open a package for a student?",
        steps: [
          "On the open packages page, press [[Open a package]].",
          "Choose the [[Student]].",
          "Type the [[Lessons]], the [[Lesson length]] and the [[Total price]].",
          "Choose when it is billed: [[Paid up front]] or [[Paid at the end]].",
          "Press [[Open a package]].",
        ],
        note: "A student cannot have two open packages at once.",
      },
      pay: {
        title: "How do I record a package payment?",
        steps: [
          "On [[Due packages]], press [[Mark as paid]] next to the package.",
          "Choose the payment method, and type the amount if it is part.",
          "Confirm.",
        ],
        note: "To remind the parent to pay, send a reminder from the card.",
      },
      renew: {
        title: "What happens when a package runs out?",
        steps: [
          "With auto-renew on, the next package opens by itself.",
          "Otherwise press [[Open next package]] on the card.",
          "Or press [[Switch to monthly]] to put the student back on the monthly bill.",
        ],
      },
    },
  },

  subscriptions: {
    title: "Subscriptions",
    summary:
      "Students' private subscriptions: what is open, what is owed, what finished and awaits renewal, and who takes lessons without one.",
    tasks: {
      views: {
        title: "What does each tab mean?",
        steps: [
          "[[Open]]: subscriptions running now.",
          "[[Due]]: subscriptions with money still owed.",
          "[[Finished]]: subscriptions that ended and await renewal.",
          "[[No subscription]]: students taking lessons outside any subscription.",
        ],
      },
      sell: {
        title: "How do I sell a student a subscription?",
        steps: [
          "Press [[Sell a subscription]].",
          "Choose the [[Student]] and the [[Subject]].",
          "Type the [[Lessons]], the [[Lesson length]] and the [[Price per lesson]].",
          "Press [[Sell]].",
        ],
        note: "The amount is added to the family's account. Each subject has one open subscription.",
      },
      renew: {
        title: "How do I renew a finished subscription?",
        steps: [
          "Open the [[Finished]] tab.",
          "Press [[Sell next]] on the subscription's row.",
          "Check the details, then press [[Renew]].",
        ],
      },
      close: {
        title: "How do I close a subscription before it ends?",
        steps: [
          "Press [[Close]] on the subscription's row.",
          "Choose what happens to lessons paid for but not taken: [[Family credit]], [[Refund]], or [[The centre keeps it]].",
        ],
        note: "Delete is only for a subscription opened by mistake.",
      },
    },
  },

  accounting: {
    title: "Accounting",
    summary: "The academy's treasury: collecting payments with numbered receipts, following arrears, and recording expenses.",
    tasks: {
      collect: {
        title: "How do I collect a payment from a parent?",
        steps: [
          "Press [[Collect]] at the top of any page.",
          "Search for the student and pick them.",
          "Tick the amounts being paid now.",
          "Type the amount received and choose the [[Payment method]].",
          "Press the record button. The receipt is issued and can be sent on WhatsApp.",
        ],
        note: "Any payment method other than cash needs a photo of the proof of payment.",
      },
      arrears: {
        title: "How do I see who owes money?",
        steps: [
          "Open [[Arrears]] from the menu.",
          "Families are listed with the largest amount first.",
          "Press [[WhatsApp reminder]] to remind them, or [[Collect]] when they pay.",
        ],
      },
      statement: {
        title: "How do I print a family's statement?",
        steps: [
          "On the [[Arrears]] page, press [[A family’s statement]].",
          "Choose the family.",
          "Press [[Print / PDF]].",
        ],
      },
      expense: {
        title: "How do I record an expense?",
        steps: [
          "Open [[Treasury & expenses]], then the [[Expenses]] tab.",
          "Press [[New expense]].",
          "Choose the [[Category]] and [[Paid from]], and type the amount.",
          "Press [[Record expense]].",
        ],
        note: "Every expense is paid from an account. Create one first on the Accounts tab.",
      },
      void: {
        title: "I recorded a receipt by mistake. What do I do?",
        steps: [
          "Open [[Treasury & expenses]], then the [[Receipts]] tab.",
          "Open the receipt, press [[Void receipt]] and write the reason.",
          "Record the right payment again.",
        ],
        note: "A receipt's amount is never edited. A voided receipt keeps its number in the record.",
      },
    },
  },

  payroll: {
    title: "Payroll",
    summary: "Teachers' pay. Every lesson recorded as attended is added by itself to the teacher's statement for its month.",
    tasks: {
      mine: {
        title: "How do I see my pay?",
        steps: [
          "Choose the period: [[This month]] or [[Last month]].",
          "Press [[View]] on the month.",
          "You see each lesson and its pay, along with rewards and deductions.",
        ],
        note: "A lesson does not reach your pay until its outcome is recorded.",
      },
      read: {
        title: "How do I see each teacher's pay?",
        steps: [
          "Choose the period: [[This month]] or [[Last month]].",
          "Under [[Teacher salaries]], press a teacher's name to see their lessons.",
          "Press [[Statement]] on their row to open the month's statement.",
        ],
      },
      adjust: {
        title: "How do I add a reward or a deduction?",
        steps: [
          "Open the teacher's statement.",
          "Press [[Add reward]] or [[Add deduction]].",
          "Type the [[Amount]] and the [[Reason]].",
          "Save.",
        ],
        note: "The teacher sees the reason on their statement.",
      },
      transfer: {
        title: "How do I note that I sent the salary?",
        steps: [
          "Under [[Teacher salaries]], find the teacher's row.",
          "Switch on [[Transfer]].",
        ],
        note: "The switch is a note for you only. It moves no money. The system finalizes last month's statements by itself on the 3rd of each month.",
      },
    },
  },

  "discounts-awards": {
    title: "Discounts & Awards",
    summary: "Add to a teacher's pay or take from it: by hand, or automatically when a lesson is not recorded.",
    tasks: {
      add: {
        title: "How do I add an award or a discount for a teacher?",
        steps: [
          "Press [[Add award]] or [[Add discount]].",
          "Choose the [[Teacher]] and the month, and type the [[Amount]] and the [[Reason]].",
          "Save.",
        ],
        note: "The teacher sees the reason on their pay statement.",
      },
      waive: {
        title: "How do I let a teacher off an automatic deduction?",
        steps: [
          "An automatic deduction is never deleted.",
          "Press [[Waive]] on the deduction's row and write the reason.",
        ],
      },
    },
  },

  whatsapp: {
    title: "WhatsApp",
    summary: "Connect the academy's WhatsApp number so the system can send links and reminders from it.",
    tasks: {
      connect: {
        title: "How do I connect a WhatsApp number?",
        steps: [
          "On the [[WhatsApp number]] card, press [[Connect]].",
          "On your phone open WhatsApp, then Settings, then Linked devices, then Link a device.",
          "Scan the code on the screen.",
          "When it works you see [[Connected]] and your number.",
        ],
      },
      reminders: {
        title: "How do I switch lesson reminders on?",
        steps: [
          "Choose where they go: [[WhatsApp groups]], [[Private messages]] or [[Both]].",
          "Choose who receives them and how many minutes before the lesson.",
          "Press [[Save]].",
          "Press [[Launch reminders]].",
        ],
        note: "No reminder is sent until you press Launch reminders.",
      },
      assign: {
        title: "How do I link each student to their group chat?",
        steps: [
          "On the [[Assign groups]] card, choose the tab: students, teachers or groups.",
          "Pick the group chat for each name.",
          "Cannot find the group? Press [[Refresh groups]].",
        ],
        note: "Only group chats the connected number belongs to are listed.",
      },
    },
  },

  settings: {
    title: "Settings",
    summary: "The academy's settings: its details, the courses it teaches, and what teachers are allowed to do.",
    tasks: {
      profile: {
        title: "How do I change the academy's details?",
        steps: [
          "On the [[Academy Profile]] card, change the name, the time zone, the [[Default country]] and the [[Default currency]].",
          "Save.",
        ],
        note: "The academy's logo is uploaded by the support team. Send it to us and we will add it.",
      },
      courses: {
        title: "How do I add courses or subjects?",
        steps: [
          "Open the [[Courses]] tab.",
          "Add the courses or subjects you teach.",
          "They then appear in the lists when you add a teacher or a student.",
        ],
      },
      controls: {
        title: "How do I control what teachers can do?",
        steps: [
          "Open the [[Controls]] tab.",
          "Switch on or off what you want: [[Teachers can only view lessons]], [[Teachers can reschedule lessons]], [[Teachers can add a class]], [[Report required to record a lesson]].",
          "Each change saves at once.",
        ],
      },
      export: {
        title: "How do I download a copy of my data?",
        steps: [
          "Open the [[Account & data]] tab.",
          "Under [[Export your data]], download the Excel file.",
        ],
        note: "Only the academy's owner sees this tab.",
      },
    },
  },
  support: {
    title: "Support & requests",
    summary: "Send us any problem you hit or change you need, and follow each one here until it is done.",
    tasks: {
      send: {
        title: "How do I report a problem or ask for a change?",
        steps: [
          "Press [[New request]].",
          "Choose [[Problem]] if something is not working, or [[Change request]] if you want something added or changed.",
          "Write a short title and the details: what you did, what you saw, and when it started.",
          "Attach a screenshot if you can — it speeds the fix up a lot.",
          "Press [[Send request]].",
        ],
        note: "Switch on “Urgent” only when the problem is stopping your work.",
      },
      follow: {
        title: "How do I follow my request?",
        steps: [
          "Every request shows where it stands: [[Awaiting review]], [[Accepted — in progress]], [[Waiting for your reply]] or [[Done]].",
          "When the support team replies, a number appears next to the page in the menu.",
          "Open the request to read the reply, and answer from the box under the conversation.",
        ],
        note: "If a solved problem comes back, reply on the same request and it reopens.",
      },
    },
  },
};

export default en;
