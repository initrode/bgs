/**
 * Response shapes captured from the real Satchel One API, trimmed to the
 * fields the provider reads. The quirks are deliberate — the truncation
 * marker, the mid-tag cut and the BST offsets are what the live API sends.
 */

/** A to-do preview: description cut at ~100 chars, ending mid-tag. */
export const todoTruncatedMidTag = {
  id: 2007396227,
  user_id: 14768452,
  due_on: '2026-09-22T00:00:00+01:00', // midnight BST — a UTC round-trip loses a day
  completed: false,
  class_task_id: 91051974,
  class_task_type: 'Homework',
  class_task_title: 'Friday 18th September -Independent Research',
  class_task_description: '<p>Imagine you are a soldier fighting on the front lines during World War I. Write a short letter <p class="…',
  class_group_name: 'PD6R',
  subject: 'PD-History',
  teacher_name: 'Mr D. Larkins',
  issued_at: '2026-09-18T00:00:00+01:00',
  submission_status: null,
  submission_type: 'class_submission',
  submission_grade: null,
  has_attachments: false,
};

/** A preview cut cleanly, keeping its ellipsis outside any tag. */
export const todoTruncatedClean = {
  ...todoTruncatedMidTag,
  class_task_id: 90861126,
  class_task_title: 'Monday 7th September-Maths',
  class_task_description: '<p>Well done on an excellent start in our Maths lessons. Written Maths homework will commence next …</p>',
  subject: 'PD-Maths',
  completed: true,
  due_on: '2026-09-09T00:00:00+01:00',
};

/** A short description the API did not need to truncate. */
export const todoComplete = {
  ...todoTruncatedMidTag,
  class_task_id: 90861200,
  class_task_title: 'Monday 14th September - Maths',
  class_task_description: '<p>Please complete the sheet handed out in class.</p>',
  subject: 'PD-Maths',
  completed: false,
  due_on: '2026-09-16T00:00:00+01:00',
};

/** Detail payloads key the task by its type, not a fixed "homework" key. */
export const homeworkDetail = {
  lesson_occurrences: [],
  homework: {
    id: 91051974,
    title: 'Friday 18th September -Independent Research',
    subject: 'PD-History',
    due_on: '2026-09-22',
    issued_at: '2026-09-18T00:00:00+01:00',
    class_year: 'Year 6',
    class_group_name: 'PD6R',
    teacher_name: 'Mr D. Larkins',
    school_name: 'Bury Grammar Schools',
    duration: 30,
    duration_units: 'minutes',
    submission_type: 'class_submission',
    description: '<p>Imagine you are a soldier fighting on the front lines during World War I.</p><p>Write your letter on <a href="https://example.test/tea.pdf">tea-stained paper</a>.</p>',
    web_links: [],
  },
};

export const flexibleTaskDetail = {
  lesson_occurrences: [],
  flexible_task: {
    id: 90952409,
    title: 'Artist of the month',
    subject: 'PD-Art',
    due_on: '2026-10-12',
    issued_at: '2026-09-12T00:00:00+01:00',
    class_group_name: 'PD6R',
    teacher_name: 'Mrs R. Tracey',
    duration: 1,
    duration_units: 'hours',
    description: '<p>🎨 <strong>ARTIST OF THE MONTH</strong></p><p>Create your own artwork inspired by Van Gogh.</p>',
    web_links: [{ url: 'https://example.test/vangogh', title: 'Gallery' }],
  },
};

export const studentDetail = {
  student: { id: 14768452, forename: 'Alex', surname: 'Paton', year: 'Year 6' },
};
