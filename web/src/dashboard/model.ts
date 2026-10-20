/** The dashboard: widget kinds, their settings, and the data they are computed from. */

export type WidgetType = 'number' | 'countdown' | 'deadlines' | 'breakdown' | 'progress' | 'timeline' | 'honeycomb' | 'activity' | 'stuck' | 'workload' | 'note'
export type WidgetSize = 'quarter' | 'half' | 'full'
export type Widget = { id: string; type: WidgetType; size: WidgetSize; config: Record<string, unknown> }

export type DashTask = {
  id: number
  categoryId: number
  parentId: number | null
  position: number
  title: string
  statusId: number
  priorityId: number
  assigneeId: number | null
  creatorId: number | null
  labelIds: number[]
  dueDate: string | null
  createdAt: number
  updatedAt: number
  closedAt: number | null
  archivedAt: number | null
}

export type DashData = {
  now: number
  tasks: DashTask[]
  sections: { id: number; categoryId: number; title: string; position: number }[]
  activity: number[]
}

export const METRICS: { value: string; label: string; hint: string }[] = [
  { value: 'open', label: 'Unfinished', hint: 'Tasks not in a finished status' },
  { value: 'todo', label: 'Not started', hint: 'Tasks in a not-started status' },
  { value: 'active', label: 'In progress', hint: 'Tasks in an in-progress status' },
  { value: 'closed', label: 'Finished in the period', hint: 'Compared with the period before' },
  { value: 'created', label: 'Created in the period', hint: 'Compared with the period before' },
  { value: 'overdue', label: 'Overdue', hint: 'Unfinished tasks past their due date' },
  { value: 'unassigned', label: 'Unassigned', hint: 'Unfinished tasks nobody has taken' },
]

export const WIDGETS: Record<WidgetType, { title: string; description: string; size: WidgetSize; config: Record<string, unknown> }> = {
  number: { title: 'Number', description: 'One count, like unfinished bugs or tasks finished this week', size: 'quarter', config: { metric: 'open' } },
  countdown: { title: 'Countdown', description: 'Time left until a date, a task’s due date, or the next deadline', size: 'half', config: { target: 'deadline' } },
  deadlines: { title: 'Deadlines', description: 'What is overdue and what is due next', size: 'half', config: {} },
  breakdown: { title: 'Breakdown', description: 'Tasks split by category, status, priority, person or label, as a ring or bars', size: 'half', config: { by: 'status', chart: 'donut' } },
  progress: { title: 'Progress', description: 'How far each category, and each of its sections, has got', size: 'half', config: {} },
  timeline: { title: 'Created and finished', description: 'Tasks created and finished over the period', size: 'full', config: {} },
  honeycomb: { title: 'Honeycomb', description: 'Every category as a cell, darker where more is unfinished', size: 'half', config: {} },
  activity: { title: 'Activity', description: 'How many changes were made each day over half a year', size: 'full', config: {} },
  stuck: { title: 'Stuck', description: 'Tasks in progress that nobody has touched for a while', size: 'full', config: { days: 7 } },
  workload: { title: 'Workload', description: 'What each person has on their plate and has finished', size: 'full', config: {} },
  note: { title: 'Note', description: 'A short text for the team: an announcement or the rules', size: 'half', config: { title: 'Note', text: '' } },
}

export const titleOf = (w: Widget) => (typeof w.config.title === 'string' && w.config.title.trim()) || (w.type === 'number' ? METRICS.find((m) => m.value === w.config.metric)?.label : null) || WIDGETS[w.type].title

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)
export const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export const DAY = 86_400_000

/** The end of a due day in local time: that is when a task becomes overdue. */
export const dueEnd = (due: string) => {
  const [y, m, d] = due.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
}
