import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { api, dateLabel, emptyWorkspace, initials, loadWorkspace, statuses, today } from './store'
import type { Page, Priority, Project, Status, Task, User, WorkspaceData } from './store'
import Icon from './Icon'
import type { IconName } from './Icon'
import PagesView from './PagesView'
import CalendarView from './CalendarView'

type Props = { user: User; onUserChange: (user: User) => void; onLogout: () => Promise<void>; dark: boolean; toggleTheme: () => void }
type Editor = { kind: 'project'; item?: Project } | { kind: 'task'; item?: Task; status?: Status; date?: string }
type View = 'table' | 'board' | 'calendar'
const colors: Project['color'][] = ['navy', 'coral', 'green', 'purple']

export default function Workspace({ user, onUserChange, onLogout, dark, toggleTheme }: Props) {
  const [data, setData] = useState<WorkspaceData>(emptyWorkspace)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sort, setSort] = useState('created')
  const [view, setView] = useState<View>('table')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [unsavedPage, setUnsavedPage] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const path = useLocation().pathname
  const routeNavigate = useNavigate()
  function mayLeave() { return !unsavedPage || window.confirm('Discard unsaved page changes and leave this page?') }
  function navigate(to: string) { if (mayLeave()) { setUnsavedPage(false); setMobileNav(false); routeNavigate(to) } }
  function guardLink(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!mayLeave()) event.preventDefault()
    else { setUnsavedPage(false); setMobileNav(false) }
  }
  const projectId = path.startsWith('/project/') ? path.split('/')[2] : ''
  const selectedProject = data.projects.find(project => project.id === projectId)
  const inbox = path === '/inbox'
  const isTasks = ['/tasks', '/calendar', '/inbox'].includes(path) || Boolean(projectId)
  const pageTitle = selectedProject?.name || ({ '/': 'Dashboard', '/tasks': 'All tasks', '/projects': 'Projects', '/pages': 'Pages & notes', '/calendar': 'Calendar', '/inbox': 'Inbox', '/settings': 'Settings' } as Record<string, string>)[path] || 'Project'

  async function refresh() {
    const next = await loadWorkspace()
    setData(next); setLoadError('')
  }
  useEffect(() => {
    let active = true
    loadWorkspace().then(next => { if (active) setData(next) }).catch(error => { if (active) setLoadError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const [lastPath, setLastPath] = useState(path)
  if (lastPath !== path) {
    setLastPath(path); setSearch(''); setPriorityFilter('all'); setStatusFilter('all'); setMobileNav(false)
  }
  useEffect(() => {
    if (editor && dialog.current && !dialog.current.open) {
      dialog.current.showModal()
      dialog.current.querySelector<HTMLInputElement>('input')?.focus()
    }
  }, [editor])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); document.getElementById('workspace-search')?.focus() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  function openEditor(value: Editor) { setFormError(''); setEditor(value) }
  async function mutation<T>(route: string, method: string, payload?: unknown, message?: string): Promise<T> {
    setBusy(true)
    try {
      const result = await api<T>(route, method, payload)
      try { await refresh() } catch { setLoadError('Your change was saved, but the workspace could not refresh. Please retry.') }
      if (message) setToast(message)
      return result
    } finally { setBusy(false) }
  }
  async function action(route: string, method: string, payload: unknown, message: string) {
    try { await mutation(route, method, payload, message) } catch (error) { setToast(error instanceof Error ? error.message : 'Could not save. Try again.') }
  }
  async function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const fields = new FormData(event.currentTarget)
    const field = (name: string) => String(fields.get(name) ?? '').trim()
    setFormError('')
    try {
      if (editor.kind === 'project') {
        const name = field('name')
        if (!name) throw new Error('Give your project a name.')
        await mutation(`/projects${editor.item ? `/${editor.item.id}` : ''}`, editor.item ? 'PATCH' : 'POST', { name, description: field('description'), color: field('color') }, editor.item ? 'Project updated.' : 'Project created.')
      } else {
        const title = field('title')
        if (!title) throw new Error('Give your task a title.')
        const payload = { title, description: field('description'), projectId: field('projectId'), status: field('status'), priority: field('priority'), dueDate: field('dueDate'), assignee: field('assignee'), labels: field('labels').split(',').map(label => label.trim()).filter(Boolean) }
        await mutation(`/tasks${editor.item ? `/${editor.item.id}` : ''}`, editor.item ? 'PATCH' : 'POST', payload, editor.item ? 'Task updated.' : 'Task created.')
      }
      setEditor(null)
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Could not save. Try again.') }
  }
  async function deleteTask(task: Task) {
    if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return
    try { await mutation(`/tasks/${task.id}`, 'DELETE', undefined, 'Task deleted.'); setEditor(null) } catch (error) { setFormError((error as Error).message) }
  }
  async function deleteProject(project: Project) {
    if (!window.confirm(`Delete “${project.name}” and all of its tasks and pages? This cannot be undone.`)) return
    try { await mutation(`/projects/${project.id}`, 'DELETE', undefined, 'Project deleted.'); setEditor(null); if (projectId === project.id) navigate('/projects') } catch (error) { setFormError((error as Error).message) }
  }
  function changeStatus(task: Task, status: Status) {
    if (task.status !== status && !busy) void action(`/tasks/${task.id}`, 'PATCH', { status }, status === 'done' ? 'Nice work. Task completed!' : 'Task status updated.')
  }
  const weekStart = new Date(`${today()}T00:00:00`)
  weekStart.setDate(weekStart.getDate() - 6)
  const completedThisWeek = data.tasks.filter(task => task.completedAt && new Date(task.completedAt) >= weekStart).length
  const completed = data.tasks.filter(task => task.status === 'done').length
  const active = data.tasks.filter(task => task.status !== 'done')
  const dueToday = active.filter(task => task.dueDate === today()).length
  const overdue = active.filter(task => task.dueDate && task.dueDate < today()).length
  const percent = data.tasks.length ? Math.round(completed / data.tasks.length * 100) : 0
  const query = search.trim().toLowerCase()
  const tasks = data.tasks.filter(task => {
    const project = data.projects.find(item => item.id === task.projectId)
    return `${task.title} ${task.description} ${task.assignee} ${task.labels.join(' ')} ${project?.name ?? ''}`.toLowerCase().includes(query)
      && (!projectId || task.projectId === projectId) && (!inbox || !task.projectId)
      && (priorityFilter === 'all' || task.priority === priorityFilter) && (statusFilter === 'all' || task.status === statusFilter)
  }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'due' ? (a.dueDate || '9999').localeCompare(b.dueDate || '9999') : sort === 'priority' ? ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority) : b.createdAt.localeCompare(a.createdAt))
  const projects = data.projects.filter(project => `${project.name} ${project.description}`.toLowerCase().includes(query))
  const focusTask = [...active].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))[0]
  const effectiveView = path === '/calendar' ? 'calendar' : view
  const firstName = user.name.split(' ')[0]
  const nav: { path: string; label: string; icon: IconName }[] = [
    { path: '/', label: 'Dashboard', icon: 'grid' }, { path: '/tasks', label: 'All tasks', icon: 'tasks' },
    { path: '/projects', label: 'Projects', icon: 'folder' }, { path: '/calendar', label: 'Calendar', icon: 'calendar' },
    { path: '/pages', label: 'Pages & notes', icon: 'page' },
  ]

  function statusSelect(task: Task) {
    return <select disabled={busy} className={`status-select ${task.status}`} aria-label={`Status for ${task.title}`} value={task.status} onChange={event => changeStatus(task, event.target.value as Status)}>{statuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select>
  }
  function taskTable(items: Task[], compact = false) {
    return <div className="table-scroll">
      <table className={`task-table ${compact ? 'compact' : ''}`}>
        <thead>
          <tr>
            <th className="check-cell">
              <Icon name="check" size={14} />
              <span className="sr-only">Complete</span>
            </th>
            <th>Task name</th>
            <th>Status</th>{!compact && <th>Priority</th>}<th>Due date</th>{!compact && <th>Assignee</th>}<th>
              <span className="sr-only">Edit</span>
            </th>
          </tr>
        </thead>
        <tbody>{items.map(task => {
          const project = data.projects.find(item => item.id === task.projectId)
          return <tr key={task.id}>
            <td className="check-cell">
              <button className={`task-checkbox ${task.status === 'done' ? 'checked' : ''}`} disabled={busy} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => changeStatus(task, task.status === 'done' ? 'todo' : 'done')}>{task.status === 'done' && <Icon name="check" size={12} />}</button>
            </td>
            <td>
              <button className={`task-title-button ${task.status === 'done' ? 'completed' : ''}`} onClick={() => openEditor({ kind: 'task', item: task })}>{task.title}</button>
              <span className="table-project">
                <span className={`color-dot ${project?.color ?? 'navy'}`} />{project?.name || 'Inbox'}</span>
            </td>
            <td>{statusSelect(task)}</td>{!compact && <td>
              <span className={`priority ${task.priority}`}>
                <Icon name="flag" size={12} />{task.priority}</span>
            </td>}<td className={task.status !== 'done' && task.dueDate && task.dueDate < today() ? 'overdue' : 'date-cell'}>{task.dueDate === today() ? 'Today' : dateLabel(task.dueDate)}</td>{!compact && <td>
              <span className="table-assignee">{task.assignee && <span className="mini-avatar">{initials(task.assignee)}</span>}{task.assignee || 'Unassigned'}</span>
            </td>}<td>
              <button className="icon-button" aria-label={`Edit ${task.title}`} onClick={() => openEditor({ kind: 'task', item: task })}>
                <Icon name="more" size={18} />
              </button>
            </td>
          </tr>
        })}</tbody>
      </table>{!items.length && <div className="table-empty">
        <Icon name="tasks" size={26} />
        <strong>{data.tasks.length ? 'No tasks here yet.' : 'Your next step starts here.'}</strong>
        <p>Try a different filter, or add a task.</p>
        <button className="text-button" onClick={() => openEditor({ kind: 'task' })}>
          <Icon name="plus" size={14} />Add a task</button>
      </div>}</div>
  }
  function projectCard(project: Project) {
    const items = data.tasks.filter(task => task.projectId === project.id), done = items.filter(task => task.status === 'done').length
    return <article className="project-card" key={project.id}>
      <div className="project-card-top">
        <span className={`project-icon ${project.color}`}>
          <Icon name="folder" size={21} />
        </span>
        <div>
          <button disabled={busy} className={`icon-button favorite ${project.favorite ? 'is-favorite' : ''}`} aria-label={`${project.favorite ? 'Unfavorite' : 'Favorite'} ${project.name}`} onClick={() => void action(`/projects/${project.id}`, 'PATCH', { favorite: !project.favorite }, project.favorite ? 'Removed from favorites.' : 'Added to favorites.')}>
            <Icon name="star" size={18} />
          </button>
          <button className="icon-button" aria-label={`Edit ${project.name}`} onClick={() => openEditor({ kind: 'project', item: project })}>
            <Icon name="more" size={18} />
          </button>
        </div>
      </div>
      <button className="project-name" onClick={() => navigate(`/project/${project.id}`)}>{project.name}</button>
      <p>{project.description || 'A space for your next big idea.'}</p>
      <div className="project-progress-label">
        <span>{done} / {items.length} tasks complete</span>
        <strong>{items.length ? Math.round(done / items.length * 100) : 0}%</strong>
      </div>
      <progress className={project.color} value={done} max={items.length || 1} aria-label={`${project.name} completion`} />
      <div className="project-card-bottom">
        <span className="mini-avatar">{initials(user.name)}</span>
        <button className="text-button" onClick={() => navigate(`/project/${project.id}`)}>Open project<Icon name="arrow" size={15} />
        </button>
      </div>
    </article>
  }
  function weekChart() {
    const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - 6 + index); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` })
    const counts = days.map(day => data.tasks.filter(task => task.completedAt?.slice(0, 10) === day).length)
    const max = Math.max(3, ...counts)
    return <div className="week-chart" role="img" aria-label={`Tasks completed over the last seven days: ${days.map((day, i) => `${dateLabel(day)}: ${counts[i]}`).join(', ')}`}>
      <div className="chart-gridlines">
        <span />
        <span />
        <span />
      </div>{days.map((day, index) => <div className="chart-day" key={day}>
        <div className="bar-space">
          <span className={`chart-bar ${day === today() ? 'current' : ''}`} style={{ height: `${counts[index] / max * 100}%` }} title={`${dateLabel(day)}: ${counts[index]} completed`} />
          <span className="bar-count">{counts[index] || ''}</span>
        </div>
        <span>{new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}</span>
      </div>)}</div>
  }

  if (!['/', '/tasks', '/projects', '/pages', '/calendar', '/inbox', '/settings'].includes(path) && !projectId) return <Navigate to="/" replace />
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <NavLink to="/" className="brand" onClick={guardLink}>
        <span className="brand-mark">t<span />
        </span>taskflow<span className="brand-period">.</span>
      </NavLink>
      <div className="workspace-selector">
        <span className="workspace-symbol">{initials(user.name)}</span>
        <div>
          <strong>My workspace</strong>
          <span>Personal workspace</span>
        </div>
        <Icon name="down" size={14} />
      </div>
      <p className="nav-caption">WORKSPACE</p>
      <nav aria-label="Main navigation">{nav.map(item => <NavLink key={item.path} to={item.path} onClick={guardLink} end={item.path === '/'}>
        <Icon name={item.icon} size={19} />{item.label}{item.path === '/tasks' && <span className="nav-count">{active.length}</span>}</NavLink>)}<NavLink to="/inbox" onClick={guardLink}>
          <Icon name="download" size={19} />Inbox{data.tasks.some(task => !task.projectId && task.status !== 'done') && <span className="nav-dot" />}</NavLink>
      </nav>
      <div className="favorites-heading">
        <p className="nav-caption">FAVORITES</p>
        <button className="sidebar-add" aria-label="Create project" onClick={() => openEditor({ kind: 'project' })}>
          <Icon name="plus" size={15} />
        </button>
      </div>
      <nav className="favorite-nav" aria-label="Favorite projects">{data.projects.filter(project => project.favorite).map(project => <NavLink key={project.id} to={`/project/${project.id}`} onClick={guardLink}>
        <span className={`color-dot ${project.color}`} />
        <span className="favorite-name">{project.name}</span>
      </NavLink>)}{!data.projects.some(project => project.favorite) && <p className="no-favorites">Star a project to keep it close.</p>}</nav>
      <div className="sidebar-bottom">
        <div className="sidebar-reminder">
          <Icon name="leaf" size={23} />
          <strong>Progress, not perfection.</strong>
          <p>One small step is still a step.</p>
        </div>
        <NavLink className={`sidebar-setting ${path === '/settings' ? 'active' : ''}`} to="/settings" onClick={guardLink}>
          <Icon name="settings" size={18} />Settings</NavLink>
        <button className="sidebar-setting" disabled={busy} onClick={() => { if (!mayLeave()) return; setBusy(true); onLogout().catch(error => setToast(error.message)).finally(() => setBusy(false)) }}>
          <Icon name="logout" size={18} />Log out</button>
        <div className="server-status">
          <span />{loading ? 'Connecting…' : loadError ? 'Connection needs attention' : 'SQLite connected'}</div>
      </div>
    </aside>
    <div className="workspace-main">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}>
          <Icon name="menu" />
        </button>
        <div className="breadcrumb">
          <span>Workspace</span>
          <Icon name="chevron" size={13} />
          <strong>{pageTitle}</strong>
        </div>
        <label className="search-field">
          <Icon name="search" size={17} />
          <span className="sr-only">Search workspace</span>
          <input id="workspace-search" type="search" placeholder="Search anything…" value={search} onChange={event => { setSearch(event.target.value); if (path === '/settings') navigate('/tasks') }} />
          <kbd>Ctrl K</kbd>
        </label>
        <div className="topbar-actions">
          <button className="icon-button" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
            <Icon name={dark ? 'sun' : 'moon'} size={19} />
          </button>
          <span className="topbar-divider" />
          <button className="profile-button" aria-label="Open profile settings" onClick={() => navigate('/settings')}>
            <span className="avatar">{initials(user.name)}</span>
            <Icon name="down" size={13} />
          </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{path === '/' ? `YOUR DAY, A LITTLE MORE ORGANIZED` : selectedProject ? 'PROJECT WORKSPACE' : 'MY WORKSPACE'}</p>
            <h1>{pageTitle}<span className="heading-dot">.</span>
            </h1>
            <p className="heading-description">{path === '/' ? `Welcome back, ${firstName}. Let’s make some room for good work.` : selectedProject ? selectedProject.description || 'Turn the big picture into small, clear next steps.' : ({ '/tasks': 'Big picture or small details. Your work, your view.', '/projects': 'Everything you’re working toward, in one place.', '/pages': 'A place for the ideas that aren’t tasks. Yet.', '/calendar': 'A little perspective on what’s coming next.', '/inbox': 'Catch a thought now. Give it a project later.', '/settings': 'Make this workspace your own.' } as Record<string, string>)[path]}</p>
          </div>
          <div className="heading-actions">{path === '/' && <span className="today-label">
            <Icon name="calendar" size={16} />{dateLabel(today(), { weekday: 'short', month: 'short', day: 'numeric' })}</span>}{path === '/projects' ? <button className="button primary" onClick={() => openEditor({ kind: 'project' })}>
              <Icon name="plus" size={17} />New project</button> : path !== '/pages' && path !== '/settings' && <button className="button primary" onClick={() => openEditor({ kind: 'task' })}>
                <Icon name="plus" size={17} />New task</button>}{selectedProject && <button className="icon-button" aria-label="Edit this project" onClick={() => openEditor({ kind: 'project', item: selectedProject })}>
                  <Icon name="more" />
                </button>}</div>
        </div>
        {loadError && <div className="load-error" role="alert">
          <span>{loadError}</span>
          <button className="button secondary small" onClick={() => { setLoading(true); refresh().catch(error => setLoadError(error.message)).finally(() => setLoading(false)) }}>Retry</button>
        </div>}
        {loading ? <div className="loading-panel">
          <div className="loading-dots" />
          <p>Getting your workspace ready…</p>
        </div> : <>
          {projectId && !selectedProject ? <section className="empty-state panel">
            <Icon name="folder" size={34} />
            <h2>This project isn’t here.</h2>
            <p>It may have been deleted. Your other projects are still safe.</p>
            <button className="button secondary" onClick={() => navigate('/projects')}>Back to projects</button>
          </section> : <>
            {path === '/' && <>
              <section className="overview-banner">
                <div className="banner-copy">
                  <span className="banner-label">
                    <span />YOUR SPACE TO MAKE THINGS HAPPEN</span>
                  <h2>Less scattered.<br />{' '}More <span>in flow.</span>
                  </h2>
                  <p>{focusTask ? 'One clear next step can change your whole day.' : 'Your next big idea starts with one small task.'}</p>
                </div>
                <div className="focus-card">
                  <span className="eyebrow">YOUR NEXT MOVE</span>{focusTask ? <>
                    <button onClick={() => openEditor({ kind: 'task', item: focusTask })}>{focusTask.title}<Icon name="arrow" size={18} />
                    </button>
                    <div>
                      <span className={`badge ${focusTask.status}`}>{statuses.find(status => status.value === focusTask.status)?.label}</span>
                      <span>
                        <Icon name="calendar" size={13} />{dateLabel(focusTask.dueDate)}</span>
                    </div>
                  </> : <>
                    <strong>A fresh start.</strong>
                    <p>Add a task or explore an example workspace.</p>
                    <button className="text-button" onClick={() => openEditor({ kind: 'task' })}>Create your first task<Icon name="arrow" size={15} />
                    </button>
                  </>}</div>
                <div className="banner-art" aria-hidden="true">
                  <div className="art-tile one">
                    <Icon name="check" size={27} />
                  </div>
                  <div className="art-tile two">
                    <Icon name="tasks" size={35} />
                  </div>
                  <div className="art-tile three">
                    <Icon name="plus" size={22} />
                  </div>
                  <span className="art-line" />
                </div>
              </section>
              <section className="stats-grid" aria-label="Workspace statistics">{[{ label: 'Total tasks', value: data.tasks.length, icon: 'tasks', note: 'All the small steps', tone: 'navy' }, { label: 'In progress', value: data.tasks.filter(task => task.status === 'progress' || task.status === 'review').length, icon: 'activity', note: 'Good things in motion', tone: 'purple' }, { label: 'Completed', value: completed, icon: 'check', note: `${percent}% of your tasks`, tone: 'green' }, { label: 'Due today', value: dueToday, icon: 'clock', note: overdue ? `${overdue} overdue · worth a look` : 'Keep your day in focus', tone: 'coral' }].map(stat => <article className="stat-card" key={stat.label}>
                <div>
                  <span>{stat.label}</span>
                  <span className={`stat-icon ${stat.tone}`}>
                    <Icon name={stat.icon as IconName} size={18} />
                  </span>
                </div>
                <strong>{stat.value.toString().padStart(2, '0')}</strong>
                <p>{stat.note}</p>
              </article>)}</section>
              <div className="dashboard-grid">
                <div className="dashboard-primary">
                  <section className="panel dashboard-tasks">
                    <div className="panel-heading">
                      <div>
                        <h2>Your next tasks<span className="count-pill">{tasks.filter(task => task.status !== 'done').length}</span>
                        </h2>
                        <p>A little focus goes a long way.</p>
                      </div>
                      <button className="text-button" onClick={() => navigate('/tasks')}>View all<Icon name="arrow" size={15} />
                      </button>
                    </div>{taskTable(tasks.filter(task => task.status !== 'done').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')).slice(0, 5), true)}<button className="table-add" onClick={() => openEditor({ kind: 'task' })}>
                      <Icon name="plus" size={16} />Add a task</button>
                  </section>
                  <section className="panel activity-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Recent activity</h2>
                        <p>The small steps add up.</p>
                      </div>
                      <Icon name="activity" size={18} />
                    </div>{data.activity.slice(0, 4).map(item => <div className="activity-row" key={item.id}>
                      <span className="activity-mark">
                        <Icon name="check" size={12} />
                      </span>
                      <p>{item.text}</p>
                      <time dateTime={item.date}>{new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time>
                    </div>)}{!data.activity.length && <p className="empty-inline">Your changes will appear here. Start with a project or a task.</p>}</section>
                </div>
                <div className="dashboard-secondary">
                  <section className="panel momentum-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Your momentum</h2>
                        <p>Last 7 days</p>
                      </div>
                      <span className="chart-legend">
                        <span />Completed</span>
                    </div>{weekChart()}<div className="momentum-summary">
                      <strong>{completedThisWeek}<span>tasks completed</span>
                      </strong>
                      <span className="momentum-note">Every step counts.<Icon name="leaf" size={15} />
                      </span>
                    </div>
                  </section>
                  <section className="panel completion-panel">
                    <div className="panel-heading">
                      <h2>The big picture</h2>
                      <Icon name="more" size={18} />
                    </div>
                    <div className="completion-content">
                      <svg className="completion-ring" viewBox="0 0 120 120" role="img" aria-label={`${percent}% completed`}>
                        <circle cx="60" cy="60" r="49" fill="none" stroke="var(--border)" strokeWidth="9" />
                        <circle cx="60" cy="60" r="49" fill="none" stroke="var(--coral)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${percent / 100 * 307.876} 307.876`} transform="rotate(-90 60 60)" />
                        <text x="60" y="58" textAnchor="middle">{percent}%</text>
                        <text className="ring-label" x="60" y="77" textAnchor="middle">complete</text>
                      </svg>
                      <div className="completion-legend">{statuses.map(status => <div key={status.value}>
                        <span className={`status-dot ${status.value}`} />
                        <span>{status.label}</span>
                        <strong>{data.tasks.filter(task => task.status === status.value).length}</strong>
                      </div>)}</div>
                    </div>
                  </section>
                </div>
              </div>
              <div className="section-heading">
                <div>
                  <h2>Your projects</h2>
                  <p>Keep the bigger picture close.</p>
                </div>
                <button className="text-button" onClick={() => navigate('/projects')}>All projects<Icon name="arrow" size={15} />
                </button>
              </div>
              <div className="projects-grid">{projects.slice(0, 3).map(projectCard)}{!data.projects.length && <button className="project-new-card" onClick={() => openEditor({ kind: 'project' })}>
                <Icon name="plus" size={24} />
                <strong>Create your first project</strong>
                <span>Give your ideas a little structure.</span>
              </button>}</div>
              {!data.tasks.length && !data.projects.length && !data.pages.length && <div className="example-banner">
                <div>
                  <Icon name="grid" size={20} />
                  <span>
                    <strong>Want to see how it all fits together?</strong> Try a fully editable example workspace.</span>
                </div>
                <button className="button secondary small" disabled={busy} onClick={() => void action('/example', 'POST', {}, 'Example workspace added. Make it yours!')}>{busy ? 'Loading…' : 'Explore an example'}<Icon name="arrow" size={16} />
                </button>
              </div>}
            </>}
            {path === '/projects' && <>
              <div className="view-meta">
                <span>{projects.length} projects</span>
                <button className="text-button" onClick={() => openEditor({ kind: 'project' })}>
                  <Icon name="plus" size={14} />Create project</button>
              </div>
              <div className="projects-grid">{projects.map(projectCard)}<button className="project-new-card" onClick={() => openEditor({ kind: 'project' })}>
                <Icon name="plus" size={28} />
                <strong>Something new?</strong>
                <span>Create a project</span>
              </button>
              </div>{!projects.length && query && <p className="empty-inline">No projects match “{search}”.</p>}</>}
            {isTasks && <>
              <div className="task-toolbar">
                <div className="view-tabs" role="group" aria-label="Task view">{([{ value: 'table', icon: 'table', label: 'Table' }, { value: 'board', icon: 'board', label: 'Board' }, { value: 'calendar', icon: 'calendar', label: 'Calendar' }] as const).map(item => <button key={item.value} className={effectiveView === item.value ? 'active' : ''} aria-pressed={effectiveView === item.value} onClick={() => { setView(item.value); if (path === '/calendar' && item.value !== 'calendar') navigate('/tasks') }}>
                  <Icon name={item.icon} size={16} />{item.label}</button>)}</div>
                <span className="task-count">{tasks.length} tasks</span>
                <div className="task-filters">
                  <Icon name="filter" size={17} />
                  <select aria-label="Filter by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                    <option value="all">All statuses</option>{statuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select>
                  <select aria-label="Filter by priority" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}>
                    <option value="all">All priorities</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <select aria-label="Sort tasks" value={sort} onChange={event => setSort(event.target.value)}>
                    <option value="created">Newest first</option>
                    <option value="due">Due date</option>
                    <option value="priority">Priority</option>
                    <option value="title">Name A–Z</option>
                  </select>
                </div>
              </div>{(query || priorityFilter !== 'all' || statusFilter !== 'all') && <div className="filter-summary">
                <span>Showing {tasks.length} matching tasks</span>
                <button className="text-button" onClick={() => { setSearch(''); setPriorityFilter('all'); setStatusFilter('all') }}>Clear filters</button>
              </div>}
              {effectiveView === 'table' && <section className="panel all-tasks-panel">{taskTable(tasks)}<button className="table-add" onClick={() => openEditor({ kind: 'task' })}>
                <Icon name="plus" size={16} />New task</button>
              </section>}
              {effectiveView === 'board' && <div className="kanban">{statuses.map(status => <section key={status.value} className={`board-column ${status.value}`} aria-label={`${status.label} column`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={event => { event.preventDefault(); const task = data.tasks.find(item => item.id === event.dataTransfer.getData('text/plain')); if (task) changeStatus(task, status.value) }}>
                <div className="column-heading">
                  <h2>
                    <span className={`status-dot ${status.value}`} />{status.label}<span className="count-pill">{tasks.filter(task => task.status === status.value).length}</span>
                  </h2>
                  <button className="icon-button" aria-label={`Add ${status.label} task`} onClick={() => openEditor({ kind: 'task', status: status.value })}>
                    <Icon name="plus" size={17} />
                  </button>
                </div>{tasks.filter(task => task.status === status.value).map(task => <article key={task.id} className="task-card" draggable={!busy} onDragStart={event => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' }}>
                  <div className="card-top">
                    <span className={`priority ${task.priority}`}>
                      <Icon name="flag" size={11} />{task.priority}</span>
                    <button className="icon-button" aria-label={`Edit ${task.title}`} onClick={() => openEditor({ kind: 'task', item: task })}>
                      <Icon name="more" size={16} />
                    </button>
                  </div>
                  <button className="kanban-title" onClick={() => openEditor({ kind: 'task', item: task })}>{task.title}</button>{task.description && <p className="task-description">{task.description}</p>}<div className="task-labels">{task.labels.map(label => <span key={label}>{label}</span>)}</div>
                  <div className="card-project">
                    <span className={`color-dot ${data.projects.find(project => project.id === task.projectId)?.color || 'navy'}`} />{data.projects.find(project => project.id === task.projectId)?.name || 'Inbox'}</div>
                  <div className="card-footer">
                    <span className={task.dueDate && task.dueDate < today() && task.status !== 'done' ? 'overdue' : ''}>
                      <Icon name="calendar" size={12} />{dateLabel(task.dueDate)}</span>{task.assignee && <span className="mini-avatar" title={task.assignee}>{initials(task.assignee)}</span>}</div>
                  <div className="card-status">{statusSelect(task)}</div>
                </article>)}{!tasks.some(task => task.status === status.value) && <p className="column-empty">No tasks here.<br />Drop one in, or add a new step.</p>}<button className="board-add" onClick={() => openEditor({ kind: 'task', status: status.value })}>
                  <Icon name="plus" size={15} />New task</button>
              </section>)}</div>}
              {effectiveView === 'calendar' && <CalendarView tasks={tasks} onOpen={task => openEditor({ kind: 'task', item: task })} onCreate={date => openEditor({ kind: 'task', date })} />}
              {effectiveView === 'board' && <p className="board-help">Drag tasks between columns, or change their status with the menu. Assignees are labels; workspaces are private.</p>}
              {selectedProject && <section className="project-pages panel">
                <div className="panel-heading">
                  <div>
                    <h2>Project pages</h2>
                    <p>Keep the context with the work.</p>
                  </div>
                  <button className="text-button" onClick={() => navigate('/pages')}>Open pages<Icon name="arrow" size={15} />
                  </button>
                </div>{data.pages.filter(page => page.projectId === selectedProject.id).map(page => <button key={page.id} className="project-page-link" onClick={() => navigate('/pages')}>
                  <Icon name="page" size={18} />{page.title}<Icon name="arrow" size={16} />
                </button>)}{!data.pages.some(page => page.projectId === selectedProject.id) && <p className="empty-inline">Add a page in Pages & notes and link it to this project.</p>}</section>}
            </>}
            {path === '/pages' && <PagesView pages={data.pages} projects={data.projects} search={search} onDirtyChange={setUnsavedPage} onSave={(page, id) => mutation<Page>(`/pages${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', page, 'Page saved.')} onDelete={page => mutation<void>(`/pages/${page.id}`, 'DELETE', undefined, 'Page deleted.')} />}
            {path === '/settings' && <Settings user={user} onUserChange={onUserChange} dark={dark} toggleTheme={toggleTheme} onToast={setToast} />}
          </>}
          <footer className="page-footer">
            <span>taskflow<span className="brand-period">.</span> <span className="footer-motto">A little less chaos.</span>
            </span>
            <span>
              <span className="footer-dot" />{unsavedPage ? 'Page has unsaved changes' : loadError ? 'Connection needs attention' : 'Changes saved to SQLite'}</span>
          </footer>
        </>}
      </main>
    </div>
    {toast && <div className="toast" role="status">
      <span>{toast}</span>
      <button aria-label="Dismiss notification" onClick={() => setToast('')}>
        <Icon name="close" size={16} />
      </button>
    </div>}
    {editor && <dialog key={`${editor.kind}-${editor.item?.id ?? 'new'}-${editor.kind === 'task' ? editor.date ?? '' : ''}`} ref={dialog} className="editor-dialog" aria-labelledby="editor-title" onCancel={event => { if (busy) event.preventDefault(); else setEditor(null) }}>
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">MAKE IT HAPPEN</p>
          <h2 id="editor-title">{editor.item ? 'Edit' : 'New'} {editor.kind}<span className="heading-dot">.</span>
          </h2>
        </div>
        <button type="button" className="icon-button" disabled={busy} onClick={() => setEditor(null)} aria-label="Close editor">
          <Icon name="close" />
        </button>
      </div>
      <form className="form-stack" onSubmit={saveEditor}>
        <fieldset disabled={busy}>
          {editor.kind === 'project' ? <>
            <label>Project name<input name="name" required maxLength={80} autoFocus defaultValue={editor.item?.name ?? ''} placeholder="What are you working toward?" />
            </label>
            <label>Description<textarea name="description" rows={3} maxLength={2000} defaultValue={editor.item?.description ?? ''} placeholder="A little context for the bigger picture…" />
            </label>
            <label>Project color<select name="color" defaultValue={editor.item?.color ?? 'navy'}>{colors.map(color => <option key={color} value={color}>{color.charAt(0).toUpperCase() + color.slice(1)}</option>)}</select>
            </label>
          </> : <>
            <label>Task name<input name="title" autoFocus required maxLength={160} defaultValue={editor.item?.title ?? ''} placeholder="What’s the next step?" />
            </label>
            <label>Description<textarea name="description" rows={3} maxLength={4000} defaultValue={editor.item?.description ?? ''} placeholder="Add a little detail…" />
            </label>
            <label>Project<select name="projectId" defaultValue={editor.item?.projectId ?? projectId}>
              <option value="">Inbox · no project</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
            </label>
            <div className="form-row">
              <label>Status<select name="status" defaultValue={editor.item?.status ?? editor.status ?? 'todo'}>{statuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select>
              </label>
              <label>Priority<select name="priority" defaultValue={editor.item?.priority ?? 'medium'}>{(['low', 'medium', 'high'] as Priority[]).map(priority => <option key={priority} value={priority}>{priority.charAt(0).toUpperCase() + priority.slice(1)}</option>)}</select>
              </label>
            </div>
            <div className="form-row">
              <label>Due date<input name="dueDate" type="date" defaultValue={editor.item?.dueDate ?? editor.date ?? ''} />
              </label>
              <label>Assignee<input name="assignee" maxLength={80} defaultValue={editor.item?.assignee ?? user.name} placeholder="Name (display label)" />
              </label>
            </div>
            <label>Labels<span className="label-hint">Separate with commas · up to 10</span>
              <input name="labels" maxLength={300} defaultValue={editor.item?.labels.join(', ') ?? ''} placeholder="Design, School, Personal" />
            </label>
          </>}
          {formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions">{editor.item && <button type="button" className="text-button danger" onClick={() => editor.kind === 'project' ? void deleteProject(editor.item!) : void deleteTask(editor.item!)}>
            <Icon name="trash" size={15} />Delete</button>}<div>
              <button type="button" className="button secondary" onClick={() => setEditor(null)}>Cancel</button>
              <button type="submit" className="button primary">{busy ? 'Saving…' : `Save ${editor.kind}`}</button>
            </div>
          </div>
        </fieldset>
      </form>
    </dialog>}
  </div>
}

function Settings({ user, onUserChange, dark, toggleTheme, onToast }: { user: User; onUserChange: (user: User) => void; dark: boolean; toggleTheme: () => void; onToast: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fields = new FormData(event.currentTarget); setBusy(true); setError('')
    try { const result = await api<{ user: User }>('/profile', 'PATCH', { name: String(fields.get('name')).trim() }); onUserChange(result.user); onToast('Profile updated.') } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, fields = new FormData(form); setError('')
    if (fields.get('newPassword') !== fields.get('confirmPassword')) { setError('New passwords do not match.'); return }
    setBusy(true)
    try { await api('/password', 'POST', { currentPassword: fields.get('currentPassword'), newPassword: fields.get('newPassword') }); form.reset(); onToast('Password changed. Other sessions have been signed out.') } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  async function exportData() {
    setBusy(true); setError('')
    try { const data = await api<WorkspaceData>('/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `taskflow-${today()}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); onToast('Workspace exported.') } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  return <div className="settings-grid">{error && <p className="form-error settings-error" role="alert">{error}</p>}<section className="panel settings-card">
    <div className="panel-heading">
      <div>
        <h2>Your profile</h2>
        <p>The person behind the progress.</p>
      </div>
      <span className="avatar">{initials(user.name)}</span>
    </div>
    <form className="form-stack" onSubmit={saveProfile}>
      <label>Full name<input name="name" required maxLength={60} defaultValue={user.name} />
      </label>
      <label>Email address<input type="email" value={user.email} readOnly />
      </label>
      <button className="button primary" disabled={busy}>Save profile</button>
    </form>
  </section>
    <section className="panel settings-card">
      <div className="panel-heading">
        <div>
          <h2>Password & security</h2>
          <p>Keep your workspace yours.</p>
        </div>
        <Icon name="lock" />
      </div>
      <form className="form-stack" onSubmit={changePassword}>
        <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
        </label>
        <div className="form-row">
          <label>New password<input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </label>
          <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </label>
        </div>
        <button className="button secondary" disabled={busy}>Change password</button>
      </form>
    </section>
    <section className="panel settings-card">
      <div className="panel-heading">
        <div>
          <h2>Look & feel</h2>
          <p>A comfortable space to work.</p>
        </div>
        <Icon name="sun" />
      </div>
      <div className="setting-row">
        <div>
          <strong>Dark mode</strong>
          <p>A quieter screen for late-night ideas.</p>
        </div>
        <button type="button" className={`toggle-switch ${dark ? 'on' : ''}`} role="switch" aria-checked={dark} aria-label="Dark mode" onClick={toggleTheme}>
          <span />
        </button>
      </div>
    </section>
    <section className="panel settings-card">
      <div className="panel-heading">
        <div>
          <h2>Your data</h2>
          <p>Real database. No browser-only demo.</p>
        </div>
        <Icon name="download" />
      </div>
      <p className="data-description">Accounts, tasks, projects, and pages live in a SQLite database on this server. Clearing browser storage won’t delete your work. Export a copy anytime.</p>
      <button className="button secondary" disabled={busy} onClick={() => void exportData()}>
        <Icon name="download" size={16} />Export workspace</button>
      <p className="data-footnote">This version is local. Online access needs hosting and HTTPS; it is not automatically synced to the cloud.</p>
    </section>
  </div>
}
