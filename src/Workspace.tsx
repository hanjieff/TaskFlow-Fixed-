import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { NavLink, Navigate, useLocation, useNavigate } from "react-router-dom"
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
}