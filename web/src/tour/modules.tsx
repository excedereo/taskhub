/**
 * The guided tour is a set of independent guides, one per feature. Each guide and each step says when
 * it applies, so a person only ever sees what their role can use. New features add a guide here.
 *
 * The full tour walks the app in one direction: the menu once, then one category (how it is laid out,
 * how to read its list, taking and adding tasks), then a single task, and finally personal settings
 * and the profile.
 */
import type { ReactNode } from 'react'
import type { Priority, Status } from '../types.ts'
import type { TourDemo } from './demo.tsx'

export type TourCtx = {
  can: (perm: string) => boolean
  instanceName: string
  statuses: Status[]
  priorities: Priority[]
  /** Categories this person may add tasks to; null means all of them. */
  createIn: string[] | null
  canCreate: boolean
  /** Whether this person may add tasks to the example category. */
  canCreateHere: boolean
  /** An example category and task to show things on, picked from what this person can see. */
  categoryId: number | null
  taskId: number | null
  hasSections: boolean
  hasTasks: boolean
}

export type TourStep = {
  /**
   * The page this step is on. A step without one stays on the page of the step before it, so going back
   * always returns to the right page.
   */
  route?: string | ((c: TourCtx) => string | null)
  /** A data-tour name, or a CSS selector starting with "." or "[". Without a target the card shows in the middle. */
  target?: string
  title: string
  body: ReactNode | ((c: TourCtx) => ReactNode)
  when?: (c: TourCtx) => boolean
  /** The target is in the sidebar, which has to be opened on phones. */
  sidebar?: boolean
  /** Skip the step when its target is not on the page (for example a section the person cannot use), instead of showing it in the middle. */
  optional?: boolean
  /** Ask the page to draw an example when the real thing is missing (no finished task, nothing to take). */
  demo?: TourDemo
}

export type TourModule = {
  key: string
  title: string
  summary: string
  /** Guides for managing the workspace are offered separately from the everyday ones. */
  admin?: boolean
  when: (c: TourCtx) => boolean
  steps: TourStep[]
}

const TYPE_LABEL: Record<Status['type'], string> = { todo: 'not started', active: 'in progress', done: 'finished' }
const isAdmin = (c: TourCtx) => ['manage_users', 'manage_roles', 'view_audit', 'manage_settings', 'manage_categories', 'manage_integrations'].some(c.can)
// "All" is forced so a remembered filter (say, Active) cannot hide what the step points at.
const categoryRoute = (c: TourCtx) => (c.categoryId ? `/tasks/c/${c.categoryId}?status=all` : null)
// The list is explained inside the example category; without one, on All tasks.
const listRoute = (c: TourCtx) => categoryRoute(c) ?? '/tasks?status=all'
const taskRoute = (c: TourCtx) => (c.categoryId && c.taskId ? `/tasks/c/${c.categoryId}?status=all&task=${c.taskId}` : null)

export const TOUR_MODULES: TourModule[] = [
  {
    key: 'navigation',
    title: 'Getting around',
    summary: 'The menu: your tasks, all tasks, categories, analytics, the archive and your profile.',
    when: () => true,
    steps: [
      {
        route: '/tasks',
        title: 'Welcome',
        body: (c) => (
          <>
            {c.instanceName} keeps the team&apos;s tasks in one place: what needs doing, who is on it and how far along it is. This tour only shows what your role can
            use, so if a teammate has buttons you don&apos;t, that is expected.
          </>
        ),
      },
      { target: 'nav-my', sidebar: true, title: 'My tasks', body: 'Every task assigned to you, from all categories. A good place to start the day.' },
      {
        target: 'nav-all',
        sidebar: true,
        title: 'All tasks',
        body: 'Every task you are allowed to see, from every category, grouped by status.',
      },
      {
        target: 'nav-analytics',
        sidebar: true,
        title: 'Analytics',
        body: 'Numbers for the whole workspace: how many tasks are open, in progress and finished, unfinished work in each category, tasks stuck for a week, and how much each person has on their plate.',
      },
      {
        target: 'nav-archived',
        sidebar: true,
        title: 'Archived',
        body: 'Tasks taken out of the lists and analytics because they stopped mattering. Nothing is deleted: history, images and subtasks stay, and a task can be restored at any time.',
      },
      {
        target: 'nav-categories',
        sidebar: true,
        title: 'Categories',
        body: (c) =>
          c.categoryId
            ? 'Each category holds one kind of work, for example Bug reports, or one part of the project, such as World 1. Every task belongs to exactly one category. The number is how many of its tasks are not finished. We will open one in a moment.'
            : 'Each category holds one kind of work, for example Bug reports, and every task belongs to exactly one. There is none you can see yet; once someone creates one, it appears here.',
      },
      {
        target: 'nav-team',
        sidebar: true,
        when: isAdmin,
        title: 'Team',
        body: 'Pages for managing people and the workspace. You only see the ones your role is allowed to use. They have guides of their own in Settings.',
      },
      {
        target: 'nav-profile',
        sidebar: true,
        title: 'You',
        body: 'Your profile: what your role lets you do and what you are working on. The gear next to it opens your personal settings. We will end the tour there.',
      },
    ],
  },
  {
    key: 'categories',
    title: 'Inside a category',
    summary: 'Creating categories, and how a category page is laid out: sections, the Finished part, arranging.',
    when: (c) => c.categoryId !== null,
    steps: [
      {
        target: 'new-category',
        sidebar: true,
        when: (c) => c.can('manage_categories'),
        title: 'New category',
        body: 'Create a category for a new kind of work. Roles can be limited to see, or to add tasks in, only some categories.',
      },
      {
        route: categoryRoute,
        target: '.page-header',
        title: 'A category page',
        body: 'Here the tasks of one category are listed in the order they are meant to be done, not grouped by status.',
      },
      {
        target: '.stage-head',
        when: (c) => c.hasSections,
        title: 'Sections',
        body: 'A category can be split into sections, for example the stages of a plan. A section is a group of tasks inside this category, not a category of its own: its tasks still belong here. The numbers show how many of its tasks are done.',
      },
      {
        target: '.stage-finished',
        demo: 'finished',
        title: 'Finished',
        body: 'Tasks with a finished status move down here, so what is left stays on top. Their section still counts them.',
      },
      {
        target: 'arrange',
        when: (c) => c.can('manage_categories') || c.can('edit_tasks'),
        title: 'Arrange',
        body: 'Change the order of tasks, and add, rename or remove sections. Drag rows by their handle. The order is the same for everyone.',
      },
      {
        target: 'edit-category',
        when: (c) => c.can('manage_categories'),
        title: 'Edit',
        body: 'Rename the category, change its description, archive it, or archive all of its finished tasks at once.',
      },
    ],
  },
  {
    key: 'task-list',
    title: 'Reading the task list',
    summary: 'Search and filters, then every part of a task row from left to right, and the statuses.',
    when: () => true,
    steps: [
      {
        route: listRoute,
        target: 'task-filters',
        title: 'Search and filters',
        body: 'Search by words in the title or description, or by number, like #42. Narrow the list down to one person, to unassigned tasks, or to one label.',
      },
      {
        target: 'demo-row',
        demo: 'row',
        title: 'A task row',
        body: 'Each row is one task; click it to open the task. Here is an example with every part filled in, so we can go through it from left to right.',
      },
      {
        target: '[data-tour="demo-row"] .priority-icon',
        demo: 'row',
        title: 'Priorities',
        body: (c) => {
          const def = c.priorities.find((p) => p.isDefault)
          return (
            <>
              <p>The bars at the start of a row show the priority. From most to least important:</p>
              <ul className="tour-list">
                {c.priorities.map((p) => (
                  <li key={p.id}>
                    <b>{p.name}</b>
                  </li>
                ))}
              </ul>
              {def && <p>Unless someone picks another one, a new task gets {def.name}.</p>}
            </>
          )
        },
      },
      {
        target: '[data-tour="demo-row"] .task-id',
        demo: 'row',
        title: 'Task number',
        body: 'Every task has its own number, and it never changes. Search for it with #12, or use it to point at a task in a chat.',
      },
      {
        target: '[data-tour="demo-row"] .status-icon',
        demo: 'row',
        title: 'Status',
        body: 'The icon shows the task’s status. You can choose how statuses are drawn, as rings, dots or icons, in Settings.',
      },
      {
        target: 'status-filter',
        demo: 'row',
        title: 'Statuses',
        body: (c) => (
          <>
            <p>A task moves through these statuses, in this order:</p>
            <ul className="tour-list">
              {c.statuses.map((s) => (
                <li key={s.id}>
                  <b>{s.name}</b>: {TYPE_LABEL[s.type]}
                </li>
              ))}
            </ul>
            <p>
              Moving a task to a finished status closes it and records the date. A task left in an in-progress status for 7 days without any change counts as stuck in
              Analytics. Click a tab to see only that status; Active means everything not finished.
            </p>
          </>
        ),
      },
      {
        target: '[data-tour="demo-row"] .demo-chips',
        demo: 'row',
        title: 'Subtasks and images',
        body: 'How many of the task’s subtasks are done (here 1 of 3), and how many images are attached to it.',
      },
      {
        target: '[data-tour="demo-row"] .task-labels',
        demo: 'row',
        title: 'Labels',
        body: 'Tags on the task, like “backend” or “blocked”. A row shows up to three; the rest are in the task itself.',
      },
      {
        target: '[data-tour="demo-row"] .due',
        demo: 'row',
        title: 'Due date',
        body: 'When the task should be done. It turns orange when the day is close and red once it has passed.',
      },
      {
        target: '[data-tour="demo-row"] .task-time',
        demo: 'row',
        title: 'Last change',
        body: 'When anything about the task last changed. Point at it to see the exact date and time.',
      },
      {
        target: '[data-tour="demo-row"] .task-assignee',
        demo: 'row',
        title: 'Assignee',
        body: 'Who is working on the task. An empty circle means nobody is on it yet. This example shows you, since it is not a real task.',
      },
    ],
  },
  {
    key: 'taking',
    title: 'Taking work',
    summary: 'How to pick up a task that nobody is working on.',
    when: (c) => c.can('take_tasks'),
    steps: [
      {
        route: listRoute,
        target: '.take-btn',
        demo: 'take',
        title: 'Take',
        body: 'Tasks nobody is working on have a Take button. It assigns the task to you, and from then on it is in My tasks. The status stays as it was: move it on yourself when you actually start.',
      },
    ],
  },
  {
    key: 'assigned',
    title: 'How work reaches you',
    summary: 'Where the tasks assigned to you show up.',
    when: (c) => !c.can('take_tasks') && !c.can('assign_tasks'),
    steps: [
      {
        target: 'nav-my',
        sidebar: true,
        title: 'Tasks come to you',
        body: 'Your role does not pick tasks up by itself: someone assigns them to you. They appear in My tasks, and you can move them through statuses as you work on them.',
      },
    ],
  },
  {
    key: 'creating',
    title: 'Adding tasks',
    summary: 'Creating tasks and subtasks.',
    when: (c) => c.canCreate,
    steps: [
      {
        route: (c) => (c.canCreateHere ? listRoute(c) : '/tasks'),
        target: 'new-task',
        title: 'New task',
        body: (c) =>
          `Opens a short form: title, category and priority, plus assignee, due date, labels and a description if you want them. To split a task into steps, open it and add subtasks.${c.createIn ? ` Your role can add tasks only in: ${c.createIn.join(', ')}.` : ''}`,
      },
    ],
  },
  {
    key: 'task',
    title: 'Inside a task',
    summary: 'Every field of a task: status, priority, assignee, due date, labels, subtasks, history.',
    when: (c) => c.taskId !== null,
    steps: [
      {
        route: taskRoute,
        target: 'panel-props',
        title: 'Task details',
        body: (c) => (
          <>
            <ul className="tour-list">
              <li><b>Status</b>: which step the task is at.</li>
              <li><b>Priority</b>: how urgent it is.</li>
              <li><b>Assignee</b>: the one person responsible for it.</li>
              <li><b>Category</b>: which kind of work it is.</li>
              <li><b>Due</b>: the day it should be done by. It turns red once missed.</li>
              <li><b>Labels</b>: tags that cut across categories, like “backend” or “blocked”.</li>
            </ul>
            {!c.can('edit_tasks') && <p>You can change everything on tasks you created. On a task assigned to you, you can change its status. Other tasks are read-only for you.</p>}
          </>
        ),
      },
      {
        target: 'panel-assignee',
        when: (c) => c.can('assign_tasks'),
        title: 'Assigning',
        body: 'You can give this task to anyone on the team, or take it off them, right here.',
      },
      { target: 'panel-description', title: 'Description', body: 'The details: what is wrong or what is needed, steps to reproduce, links, notes.' },
      {
        target: 'panel-subtasks',
        optional: true,
        title: 'Subtasks',
        body: 'Smaller steps of this task, each with its own status and assignee. Click the circle to finish one; the task shows how many are done.',
      },
      { target: 'panel-images', optional: true, title: 'Images', body: 'Paste a screenshot with Ctrl+V, drop files onto the panel, or pick them. Click one to see it full size.' },
      {
        target: 'panel-activity',
        title: 'Activity',
        body: 'The full history of the task: who changed what and when. A change marked “via …” was made by a script or an AI agent through someone’s API token.',
      },
    ],
  },
  {
    key: 'personal',
    title: 'Your settings',
    summary: 'Theme, density and your own colors for statuses and priorities.',
    when: () => true,
    steps: [
      {
        route: '/settings',
        target: 'theme',
        title: 'Theme',
        body: 'System follows your device. Custom lets you choose your own colors. More themes holds built-in themes and the ones your workspace added. Everything on this page is saved in this browser.',
      },
      { target: 'display', title: 'Display', body: 'Compact rows, fewer animations, and how status and priority icons are drawn next to tasks.' },
      {
        target: 'looks',
        title: 'Colors and icons',
        body: 'Give each status and priority your own color and icon. Only you see them; everyone else keeps the workspace defaults.',
      },
      { target: 'guides', title: 'Guides', body: 'Every part of this tour, to replay whenever you like.' },
    ],
  },
  {
    key: 'profile',
    title: 'Your profile',
    summary: 'What your role allows, and API tokens for AI agents.',
    when: () => true,
    steps: [
      {
        route: '/profile',
        target: 'my-permissions',
        title: 'What you can do',
        body: 'Your role’s permissions in plain words. If you need something that is missing, ask whoever manages roles.',
      },
      {
        target: 'api-tokens',
        when: (c) => c.can('use_api'),
        title: 'API tokens',
        body: 'Let a script or an AI agent such as Claude Code work as you, with exactly your permissions. Its changes are marked with the token’s name. Keep tokens secret, like a password.',
      },
    ],
  },

  // Managing the workspace
  {
    key: 'users',
    title: 'Managing people',
    summary: 'Adding people, changing roles, disabling accounts.',
    admin: true,
    when: (c) => c.can('manage_users'),
    steps: [
      {
        route: '/users',
        target: 'add-user',
        title: 'Adding people',
        body: 'Add someone by their Discord user ID and choose their role, then they can sign in with Discord. Unless registration is open in Workspace settings, nobody can join without being added here.',
      },
      {
        target: 'users-table',
        title: 'The team',
        body: 'Change someone’s role or disable their account; a disabled person is signed out at once. Click a column header to sort. You can only hand out roles whose permissions you have yourself.',
      },
    ],
  },
  {
    key: 'roles',
    title: 'Roles',
    summary: 'Permissions, category limits and the role hierarchy.',
    admin: true,
    when: (c) => c.can('manage_roles'),
    steps: [
      {
        route: '/roles',
        target: 'role-list',
        title: 'Roles and their order',
        body: 'Everyone has exactly one role. This list is the hierarchy: drag roles to set their order, and it is used everywhere roles are listed. Owner always stays on top and has every permission.',
      },
      {
        target: 'role-editor',
        title: 'What a role allows',
        body: 'Tick permissions to grant them. Visible categories hide whole categories from a role, including their tasks, history and analytics. Creating tasks can be limited to some categories. You cannot grant anything you do not have yourself.',
      },
    ],
  },
  {
    key: 'workspace',
    title: 'Workspace settings',
    summary: 'Name, sign-up rules, statuses, priorities and labels.',
    admin: true,
    when: (c) => c.can('manage_settings') || c.can('manage_categories'),
    steps: [
      {
        route: '/workspace',
        target: 'workspace-form',
        when: (c) => c.can('manage_settings'),
        title: 'Workspace',
        body: 'The name and logo everyone sees, whether anyone can sign up or only people you add, and which role newcomers get.',
      },
      {
        route: '/workspace',
        target: 'statuses',
        when: (c) => c.can('manage_settings'),
        title: 'Statuses',
        body: 'The steps a task goes through, in order. Each has a type: Not started, In progress or Done. The type decides when a task counts as finished, and what happens when it is taken off its assignee. Colors and icons are chosen by each person.',
      },
      {
        target: 'priorities',
        when: (c) => c.can('manage_settings'),
        title: 'Priorities',
        body: 'From most to least important. The star marks the one new tasks get.',
      },
      {
        route: '/workspace',
        target: 'labels',
        when: (c) => c.can('manage_categories'),
        title: 'Labels',
        body: 'Tags that cut across categories, like “backend” or “needs design”. Use them for what a category does not say about a task.',
      },
    ],
  },
  {
    key: 'themes',
    title: 'Workspace themes',
    summary: 'Themes everyone can pick, with optional CSS.',
    admin: true,
    when: (c) => c.can('manage_themes'),
    steps: [
      {
        route: '/settings',
        target: 'theme',
        title: 'Workspace themes',
        body: 'Under More themes you can add themes everyone can pick: six base colors plus optional CSS for effects. If a theme’s CSS ever breaks the page, add ?safe to the address to load it without the theme.',
      },
    ],
  },
  {
    key: 'integrations',
    title: 'Integrations',
    summary: 'Posting events to Discord.',
    admin: true,
    when: (c) => c.can('manage_integrations'),
    steps: [
      {
        route: '/integrations',
        target: '.page-header',
        title: 'Discord webhooks',
        body: 'Post what happens to a Discord channel: new tasks, status changes, finished work and more, for all categories or only some. A burst of changes is combined into one message.',
      },
    ],
  },
  {
    key: 'audit',
    title: 'Audit log',
    summary: 'The history of every change.',
    admin: true,
    when: (c) => c.can('view_audit'),
    steps: [
      {
        route: '/audit',
        target: '.page-header',
        title: 'Audit log',
        body: 'Every change in the workspace: who made it, what changed and when, including roles and settings. It cannot be edited. Use the tabs and the person filter to narrow it down.',
      },
    ],
  },
]
