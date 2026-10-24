export type User = { id: string; name: string; email: string }
export type Project = { id: string; name: string; description: string; color: 'navy' | 'coral' | 'green' | 'purple'; favorite: boolean; createdAt: string }
export type Status = 'todo' | 'progress' | 'review' | 'done'
export type Priority = 'low' | 'medium' | 'high'
export type Task = {
  id: string; projectId: string; title: string; description: string; status: Status;
  priority: Priority; dueDate: string; assignee: string; labels: string[];
  createdAt: string; updatedAt: string; completedAt: string | null;
}
export type Block = { id: string; type: 'text' | 'heading' | 'checklist'; content: string; checked: boolean }
export type Page = { id: string; projectId: string; title: string; blocks: Block[]; createdAt: string; updatedAt: string }
export type Activity = { id: string; text: string; date: string }
export type WorkspaceData = { projects: Project[]; tasks: Task[]; pages: Page[]; activity: Activity[] }

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin',
      headers: ['POST', 'PATCH', 'DELETE'].includes(method) ? { 'Content-Type': 'application/json' } : undefined,
      body: ['POST', 'PATCH', 'DELETE'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    })
  } catch { throw new Error('Cannot reach the server. Check that TaskFlow is running and try again.') }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'))
    throw new ApiError(data?.error || 'Something went wrong. Please try again.', response.status)
  }
  return data as T
}

export async function currentUser() { return (await api<{ user: User | null }>('/session')).user }
export async function register(name: string, email: string, password: string) {
  return (await api<{ user: User }>('/auth/signup', 'POST', { name, email, password })).user
}
export async function login(email: string, password: string) {
  return (await api<{ user: User }>('/auth/login', 'POST', { email, password })).user
}
export async function logout() { await api('/auth/logout', 'POST', {}) }
export async function loadWorkspace() { return api<WorkspaceData>('/workspace') }
export const emptyWorkspace: WorkspaceData = { projects: [], tasks: [], pages: [], activity: [] }
export const statuses: { value: Status; label: string }[] = [
  { value: 'todo', label: 'To do' }, { value: 'progress', label: 'In progress' },
  { value: 'review', label: 'In review' }, { value: 'done', label: 'Done' },
]
export function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function dateLabel(value: string, options?: Intl.DateTimeFormatOptions) {
  return value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', options ?? { month: 'short', day: 'numeric' }) : 'No due date'
}
export function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() }
