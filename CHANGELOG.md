# Changelog

New features raise the middle number (0.2.0 → 0.3.0), fixes and small changes raise the last one (0.3.0 → 0.3.1).

## 1.1.0 — 2026-10-20

- Arrange Analytics right on the page: every widget gets a toolbar, drag it around the grid by its handle (or move it with the arrow keys), change its size and settings in place, and add widgets from the last tile
- The page is called Analytics again; /dashboard still opens it
- Progress is compact: one bar per category, and its sections fold out with the arrow; which ones are open is remembered per person

## 1.0.0 — 2026-10-20

The first stable release.

**Dashboard**
- Analytics becomes a dashboard for the whole workspace, built from widgets: Number, Countdown, Deadlines, Breakdown (ring or bars, by category, status, priority, person or label), Progress, Created and finished, Honeycomb, Activity calendar, Stuck, Workload and Note
- People with the new Manage dashboard permission add widgets, drag them into order, pick a size (a quarter, half or the full width) and set each one up; changes are recorded in the audit log
- The default layout covers what the old Analytics page showed, plus a countdown to the next deadline and the list of deadlines
- Widgets only count what the viewer is allowed to see; archived tasks still count in history, so archiving does not rewrite the past
- /analytics now opens the dashboard

## 0.2.0 — 2026-10-20

Everything added since the first release.

**Tasks and categories**
- Category folders in the sidebar: group categories, fold them, see the unfinished count of a folded folder
- Choose where finished tasks go inside a category: at the bottom (labelled with their section), at the bottom of each section, or in place
- Finished rows fade as a whole
- Labels and due dates
- Editable statuses with types (not started, in progress, done) and editable priorities, including Acknowledged and Light by default
- Take only assigns the task; the status stays as it was
- Archived categories can be found and restored on the Archived page
- Delete a category together with its tasks, behind its own permission and a typed confirmation

**People and permissions**
- Roles in a hierarchy, ordered by dragging
- Users can be sorted by any column, with the date they joined
- New permissions: Manage themes, Manage integrations, Use the API and AI agents, Delete categories with tasks

**Look and feel**
- Personal settings: theme, density, animations, how status and priority icons are drawn, your own colors and icons
- Custom themes, built-in themes (Midnight, Forest, Paper, Frost) and workspace themes with optional CSS; `?safe` turns a workspace theme off
- A guided tour built from separate guides, each shown only to people whose role can use it
- The Taskhub logo, and the version with links to the source in the profile

**Integrations**
- Discord webhooks that post chosen events, combined into one message when several happen at once
- Personal API tokens and an MCP server, so AI agents can work in Taskhub with their owner's permissions; their changes are marked “via” the token name (administrators can turn that off)

**Other**
- Taskhub is now licensed under the AGPL-3.0; earlier versions were MIT

## 0.1.0 — 2026-10-16

The first release: tasks, categories with sections and subtasks, roles with category limits, Discord sign-in, images, archive, analytics and the audit log.
