/**
 * The guided tour is a set of independent guides, one per feature. Each guide and each step says when
 * it applies, so a person only ever sees what their role can use. New features add a guide here.
 */
import type { ReactNode } from 'react'
import type { Priority, Status } from '../types.ts'

export type TourCtx = {
  can: (perm: string) => boolean
  instanceName: string
  statuses: Status[]
  priorities: Priority[]
  /** Categories this person may add tasks to; null means all of them. */
  createIn: string[] | null
  canCreate: boolean
  /** An example category and task to show things on, picked from what this person can see. */
  categoryId: number | null
  taskId: number | null
  hasSections: boolean
  hasFinished: boolean
  hasUnassigned: boolean
  hasTasks: boolean
}

export type TourStep = {
  /** Where to go first; a step without a route stays on the current page. */
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
const categoryRoute = (c: TourCtx) => (c.categoryId ? `/tasks/c/${c.categoryId}` : null)
const taskRoute = (c: TourCtx) => (c.categoryId && c.taskId ? `/tasks/c/${c.categoryId}?task=${c.taskId}` : null)

export const TOUR_MODULES: TourModule[] = [
  {
    key: 'navigation',
    title: 'Getting around',
    summary: 'The menu: your tasks, all tasks, categories and your profile.',
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
        body: 'Every task you are allowed to see, grouped by status. Finished tasks are hidden here unless you switch the filter to a finished status or All.',
      },
      {
        target: 'nav-categories',
        sidebar: true,
        title: 'Categories',
        body: (c) =>
          c.categoryId
            ? 'Each category holds one kind of work, for example Bug reports, or one part of the project, such as World 1. Every task belongs to exactly one category. The number shows how many of its tasks are not finished yet.'
            : 'Each category holds one kind of work, for example Bug reports. There is none you can see yet; once someone creates one, it appears here.',
      },
      {
        target: 'nav-team',
        sidebar: true,
        when: isAdmin,
        title: 'Team',
        body: 'Pages for managing people and the workspace. You only see the ones your role is allowed to use.',
      },
      {
        target: 'nav-profile',
        sidebar: true,
        title: 'You',
        body: 'Your profile: what your role lets you do and what you are working on. The gear next to it opens your personal settings.',
      },
    ],
  },
  {
    key: 'categories',
    title: 'Inside a category',
    summary: 'How a category page is laid out: sections, the Finished part and arranging.',
    when: (c) => c.categoryId !== null,
    steps: [
      {
        route: categoryRoute,
        target: '.page-header',
        title: 'A category page',
        body: 'Here the tasks of one category are listed in the order they are meant to be done, not grouped by status. Finished work collects at the bottom.',
      },
      {
        target: '.stage-head',
        when: (c) => c.hasSections,
        title: 'Sections',
        body: 'A category can be split into sections, for example the stages of a plan. A section is a group of tasks inside this category, not a category of its own: its tasks still belong here.',
      },
      {
        target: '.stage-finished',
        when: (c) => c.hasFinished,
        title: 'Finished',
        body: 'Tasks with a finished status move down here, so what is left stays on top. Each section still counts them in its progress.',
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
      {
        target: 'new-category',
        sidebar: true,
        when: (c) => c.can('manage_categories'),
        title: 'New category',
        body: 'Create a category for a new kind of work. Roles can be limited to see, or to add tasks in, only some categories.',
      },
    ],
  },
  {
    key: 'task-list',
    title: 'Reading the task list',
    summary: 'What each part of a task row means, and how to filter the list.',
    when: () => true,
    steps: [
      {
        route: '/tasks?status=all',
        target: '.task-row',
        title: 'A task row',
        body: (c) =>
          c.hasTasks
            ? 'From left to right: priority (more bars means more important), the task number, its status, the title, then subtasks done, images, labels, due date, the time of the last change and who is working on it. Click a row to open the task.'
            : 'Tasks show up here as rows: priority, number, status and title, then who is working on it. There are no tasks you can see yet.',
      },
      {
        target: 'status-filter',
        title: 'Status filter',
        body: 'Show only the tasks in one status. Active means everything that is not finished. Your choice is remembered separately for each list.',
      },
      {
        target: 'task-filters',
        title: 'Search and filters',
        body: 'Search by words in the title or description, or by number, like #42. Narrow the list down to one person, to unassigned tasks, or to one label.',
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
    key: 'statuses',
    title: 'Statuses and priorities',
    summary: 'What each status and priority in this workspace means.',
    when: () => true,
    steps: [
      {
        route: '/tasks?status=all',
        target: 'status-filter',
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
              What a status does depends on that type. Moving a task to a finished status closes it and records the date. A task that sits in an in-progress status
              for 7 days without any change is counted as stuck in Analytics.
            </p>
          </>
        ),
      },
      {
        title: 'Priorities',
        body: (c) => {
          const def = c.priorities.find((p) => p.isDefault)
          return (
            <>
              <p>From most to least important:</p>
              <ul className="tour-list">
                {c.priorities.map((p) => (
                  <li key={p.id}>
                    <b>{p.name}</b>
                    {p.isDefault ? ' (new tasks get this one)' : ''}
                  </li>
                ))}
              </ul>
              {def && <p>Unless someone picks another, a new task gets {def.name}.</p>}
            </>
          )
        },
      },
    ],
  },
  {
    key: 'taking',
    title: 'Taking work',
    summary: 'How to pick up a task, and how tasks get assigned.',
    when: (c) => c.can('take_tasks') || c.can('assign_tasks'),
    steps: [
      {
        route: '/tasks?status=active&assignee=none',
        target: '.take-btn',
        when: (c) => c.can('take_tasks') && c.hasUnassigned,
        title: 'Take',
        body: (c) => {
          const firstActive = c.statuses.find((s) => s.type === 'active')
          return `Take assigns an unassigned task to you. If it has not started yet, it moves to ${firstActive?.name ?? 'the first in-progress status'}. From then on it is in My tasks.${c.hasUnassigned ? '' : ' Right now nothing is waiting to be taken.'}`
        },
      },
      {
        route: taskRoute,
        target: 'panel-assignee',
        when: (c) => c.can('assign_tasks') && c.taskId !== null,
        title: 'Assigning',
        body: 'You can give a task to anyone on the team, or take it off them, from the Assignee field of the task.',
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
        route: '/tasks',
        target: 'new-task',
        title: 'New task',
        body: (c) =>
          `Opens a short form: title, category and priority, plus assignee, due date, labels and a description if you want them. To split a task into steps, open it and add subtasks.${c.createIn ? ` Your role can add tasks only in: ${c.createIn.join(', ')}.` : ''}`,
      },
    ],
  },
  {
    key: 'overview',
    title: 'Analytics and Archive',
    summary: 'The numbers, and where old tasks go.',
    when: () => true,
    steps: [
      {
        target: 'nav-analytics',
        sidebar: true,
        title: 'Analytics',
        body: 'Numbers for the whole workspace: how many tasks are open, in progress and finished, unfinished work in each category, progress of each section, tasks stuck for a week, and how much each person has on their plate.',
      },
      {
        target: 'nav-archived',
        sidebar: true,
        title: 'Archived',
        body: 'Tasks taken out of the lists and analytics because they stopped mattering. Nothing is deleted: history, images and subtasks stay, and a task can be restored at any time.',
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
        body: 'The steps a task goes through, in order. Each has a type: Not started, In progress or Done. The type decides what Take does and when a task counts as finished. Colors and icons are chosen by each person.',
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
