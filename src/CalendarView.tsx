import { useState } from 'react'
import type { Task } from './store'
import { today } from './store'
import Icon from './Icon'

export default function CalendarView({ tasks, onOpen, onCreate }: { tasks: Task[]; onOpen: (task: Task) => void; onCreate: (date: string) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first); start.setDate(1 - first.getDay())
  const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day })
  function shift(amount: number) { setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1)) }
  return <section className="panel calendar-panel" aria-label="Task calendar">
    <div className="calendar-toolbar">
      <h2>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
      <div>
        <button className="button secondary small" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
        <button className="icon-button" aria-label="Previous month" onClick={() => shift(-1)}>
          <Icon name="left" size={18} />
        </button>
        <button className="icon-button" aria-label="Next month" onClick={() => shift(1)}>
          <Icon name="chevron" size={18} />
        </button>
      </div>
    </div>
    <div className="calendar-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">{days.map(day => {
      const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
      const entries = tasks.filter(task => task.dueDate === date)
      return <div key={date} className={`calendar-day ${day.getMonth() !== month.getMonth() ? 'outside' : ''} ${date === today() ? 'is-today' : ''}`}>
        <div className="calendar-day-head">
          <span>{day.getDate()}</span>
          <button className="calendar-add" aria-label={`Add task on ${date}`} onClick={() => onCreate(date)}>
            <Icon name="plus" size={13} />
          </button>
        </div>{entries.map(task => <button key={task.id} className={`calendar-event ${task.status}`} onClick={() => onOpen(task)} title={task.title}>
          <span className={`status-dot ${task.status}`} />{task.title}</button>)}</div>
    })}</div>
    <p className="calendar-caption">Tasks without a due date appear in Table and Board views.</p>
  </section>
}
