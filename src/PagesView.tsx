import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Block, Page, Project } from './store'

type PageDraft = Pick<Page, 'title' | 'projectId' | 'blocks'>

export type PagesViewProps = {
  pages: Page[]
  projects: Project[]
  search: string
  onSave: (page: PageDraft, id?: string) => Promise<Page>
  onDelete: (page: Page) => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}

type EditorState = {
  page: Page | null
  draft: PageDraft
  baseline: string
}

function createBlock(type: Block['type']): Block {
  return { id: crypto.randomUUID(), type, content: '', checked: false }
}

function createEditor(page: Page | null): EditorState {
  const draft: PageDraft = page
    ? { title: page.title, projectId: page.projectId, blocks: page.blocks.map((block) => ({ ...block })) }
    : { title: '', projectId: '', blocks: [createBlock('text')] }
  return { page, draft, baseline: JSON.stringify(draft) }
}

function dateLabel(value: Page['updatedAt']) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Recently updated'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function SaveSpinner() {
  const [reducedMotion, setReducedMotion] = useState(true)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(preference.matches)
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  return (
    <svg className="note-save-spinner" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        {!reducedMotion && (
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
        )}
      </path>
    </svg>
  )
}

function BlockContent({ block, position, disabled, onChange }: {
  block: Block
  position: number
  disabled: boolean
  onChange: (content: string) => void
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [block.content, block.type])

  const label = `${block.type === 'heading' ? 'Heading' : block.type === 'checklist' ? 'Checklist' : 'Text'} block ${position}`

  if (block.type === 'heading') {
    return (
      <input
        className="note-block-input"
        aria-label={label}
        placeholder="Heading"
        value={block.content}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return (
    <textarea
      ref={textarea}
      className="note-block-input"
      aria-label={label}
      placeholder={block.type === 'checklist' ? 'To-do item' : 'Write something…'}
      rows={1}
      value={block.content}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export default function PagesView({ pages, projects, search, onSave, onDelete, onDirtyChange }: PagesViewProps) {
  const [editor, setEditor] = useState<EditorState>(() => createEditor(pages[0] ?? null))
  const [operation, setOperation] = useState<'saving' | 'deleting' | null>(null)
  const [error, setError] = useState('')
  const operationLock = useRef(false)
  const mounted = useRef(true)
  const titleInput = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const projectId = useId()
  const libraryId = useId()
  const blocksId = useId()
  const dirty = JSON.stringify(editor.draft) !== editor.baseline
  const busy = operation !== null
  const selectedId = editor.page?.id
  const query = search.trim().toLocaleLowerCase()

  const filteredPages = useMemo(() => pages.filter((page) =>
    !query || page.title.toLocaleLowerCase().includes(query)
    || page.blocks.some((block) => block.content.toLocaleLowerCase().includes(query)),
  ), [pages, query])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  useEffect(() => {
    if (!dirty && !busy) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [dirty, busy])

  function mayDiscard(action: string) {
    return !dirty || window.confirm(`You have unsaved changes. Discard them and ${action}?`)
  }

  function openPage(page: Page) {
    if (operationLock.current || page.id === selectedId || !mayDiscard('open another page')) return
    setEditor(createEditor(page))
    setError('')
    titleInput.current?.focus()
  }

  function newPage() {
    if (operationLock.current || !mayDiscard('start a new page')) return
    setEditor(createEditor(null))
    setError('')
    titleInput.current?.focus()
  }

  function updateDraft(change: Partial<PageDraft>) {
    if (operationLock.current) return
    setEditor((current) => ({ ...current, draft: { ...current.draft, ...change } }))
    setError('')
  }

  function updateBlock(id: string, change: Partial<Pick<Block, 'content' | 'checked'>>) {
    if (operationLock.current) return
    setEditor((current) => ({
      ...current,
      draft: {
        ...current.draft,
        blocks: current.draft.blocks.map((block) => block.id === id ? { ...block, ...change } : block),
      },
    }))
    setError('')
  }

  function addBlock(type: Block['type']) {
    updateDraft({ blocks: [...editor.draft.blocks, createBlock(type)] })
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= editor.draft.blocks.length) return
    const blocks = [...editor.draft.blocks]
      ;[blocks[index], blocks[target]] = [blocks[target], blocks[index]]
    updateDraft({ blocks })
  }

  async function savePage() {
    if (operationLock.current || (editor.page && !dirty)) return
    operationLock.current = true
    setOperation('saving')
    setError('')
    try {
      const saved = await onSave({
        ...editor.draft,
        title: editor.draft.title.trim() || 'Untitled',
        blocks: editor.draft.blocks.map((block) => ({ ...block })),
      }, selectedId)
      if (!saved?.id) throw new Error('The saved page was not returned. Try saving again.')
      if (mounted.current) setEditor(createEditor(saved))
    } catch (cause) {
      if (mounted.current) {
        const detail = cause instanceof Error ? ` ${cause.message}` : ''
        setError(`Could not save this page.${detail} Your changes are still here; try saving again.`)
      }
    } finally {
      operationLock.current = false
      if (mounted.current) setOperation(null)
    }
  }

  async function deletePage() {
    const page = editor.page
    if (operationLock.current || !page) return
    const unsavedWarning = dirty ? ' Your unsaved changes will also be discarded.' : ''
    if (!window.confirm(`Delete “${page.title || 'Untitled'}”?${unsavedWarning} This cannot be undone.`)) return
    operationLock.current = true
    setOperation('deleting')
    setError('')
    try {
      await onDelete(page)
      if (mounted.current) {
        setEditor(createEditor(pages.find((item) => item.id !== page.id) ?? null))
        titleInput.current?.focus()
      }
    } catch (cause) {
      if (mounted.current) {
        const detail = cause instanceof Error ? ` ${cause.message}` : ''
        setError(`Could not delete this page.${detail} Your page and changes are still here; try again.`)
      }
    } finally {
      operationLock.current = false
      if (mounted.current) setOperation(null)
    }
  }

  return (
    <div className="notes-layout">
      <aside className="page-library panel" aria-labelledby={libraryId}>
        <header className="page-library-heading">
          <p className="eyebrow">YOUR WORKSPACE NOTES</p>
          <h2 id={libraryId}>Pages <span className="muted">{pages.length}</span>
          </h2>
          <p className="muted">Ideas, plans, and the details between tasks.</p>
          <button type="button" className="button primary" onClick={newPage} disabled={busy}>
            <span aria-hidden="true">+</span> New page
          </button>
        </header>

        {filteredPages.length > 0 ? (
          <ul className="page-list" aria-label="Saved pages">
            {filteredPages.map((page) => {
              const preview = page.blocks.find((block) => block.content.trim())?.content.trim()
              const project = projects.find((item) => item.id === page.projectId)
              return (
                <li key={page.id}>
                  <button
                    type="button"
                    className={`page-list-item${selectedId === page.id ? ' active' : ''}`}
                    aria-current={selectedId === page.id ? 'page' : undefined}
                    disabled={busy}
                    onClick={() => openPage(page)}
                  >
                    <strong>{page.title || 'Untitled'}</strong>
                    <span className="muted page-preview">{preview ? preview.slice(0, 120) : 'No content yet'}</span>
                    <span className="muted page-meta">
                      {project?.name ?? (page.projectId ? 'Unavailable project' : 'Personal')}
                      {' · '}{dateLabel(page.updatedAt)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="page-library-empty">
            <h3>{pages.length ? 'No matching pages' : 'A place for your next idea'}</h3>
            <p className="muted">
              {pages.length
                ? 'Search a title or something inside a page, or start a new one.'
                : 'Create your first page for meeting notes, a project plan, or a simple checklist.'}
            </p>
            <button type="button" className="text-button" onClick={newPage} disabled={busy}>
              {pages.length ? 'Create a new page' : 'Create your first page'}
            </button>
          </div>
        )}
      </aside>

      <section className="note-editor panel" aria-label="Page editor" aria-busy={busy}>
        <header className="note-toolbar">
          <p className="eyebrow">{editor.page ? 'PAGE' : 'NEW PAGE'}</p>
          <button
            type="button"
            className="button quiet"
            onClick={() => { void deletePage() }}
            disabled={busy || !editor.page}
          >
            {operation === 'deleting' ? 'Deleting…' : 'Delete page'}
          </button>
        </header>

        <label className="eyebrow" htmlFor={titleId}>PAGE TITLE</label>
        <input
          ref={titleInput}
          id={titleId}
          className="note-title-input"
          placeholder="Untitled"
          maxLength={160}
          value={editor.draft.title}
          disabled={busy}
          onChange={(event) => updateDraft({ title: event.target.value })}
        />

        <div className="note-properties">
          <label htmlFor={projectId}>Project</label>
          <select
            id={projectId}
            value={editor.draft.projectId}
            disabled={busy}
            onChange={(event) => updateDraft({ projectId: event.target.value })}
          >
            <option value="">Personal · no project</option>
            {editor.draft.projectId && !projects.some((project) => project.id === editor.draft.projectId) && (
              <option value={editor.draft.projectId}>Unavailable project</option>
            )}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          {editor.page && <span className="muted">Updated {dateLabel(editor.page.updatedAt)}</span>}
        </div>

        <div className="note-blocks" id={blocksId} aria-label="Page blocks">
          {editor.draft.blocks.map((block, index) => (
            <div
              key={block.id}
              className={`note-block note-block--${block.type}${block.type === 'checklist' && block.checked ? ' checked' : ''}`}
            >
              {block.type === 'checklist' && (
                <input
                  className="note-checkbox"
                  type="checkbox"
                  aria-label={`Mark checklist item ${index + 1} as ${block.checked ? 'incomplete' : 'complete'}`}
                  checked={block.checked}
                  disabled={busy}
                  onChange={(event) => updateBlock(block.id, { checked: event.target.checked })}
                />
              )}
              <BlockContent
                block={block}
                position={index + 1}
                disabled={busy}
                onChange={(content) => updateBlock(block.id, { content })}
              />
              <div className="block-controls" role="group" aria-label={`Controls for block ${index + 1}`}>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move block ${index + 1} up`}
                  title="Move up"
                  disabled={busy || index === 0}
                  onClick={() => moveBlock(index, -1)}
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move block ${index + 1} down`}
                  title="Move down"
                  disabled={busy || index === editor.draft.blocks.length - 1}
                  onClick={() => moveBlock(index, 1)}
                >
                  <span aria-hidden="true">↓</span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove block ${index + 1}`}
                  title="Remove block"
                  disabled={busy}
                  onClick={() => updateDraft({ blocks: editor.draft.blocks.filter((item) => item.id !== block.id) })}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </div>
          ))}
          {editor.draft.blocks.length === 0 && <p className="muted">Add a block below to start writing.</p>}
        </div>

        <div className="add-blocks" role="group" aria-label="Add a block">
          <button type="button" className="button secondary" disabled={busy || editor.draft.blocks.length >= 200} aria-controls={blocksId} onClick={() => addBlock('text')}>+ Text</button>
          <button type="button" className="button secondary" disabled={busy || editor.draft.blocks.length >= 200} aria-controls={blocksId} onClick={() => addBlock('heading')}>+ Heading</button>
          <button type="button" className="button secondary" disabled={busy || editor.draft.blocks.length >= 200} aria-controls={blocksId} onClick={() => addBlock('checklist')}>+ Checklist</button>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <footer className="note-savebar">
          <div className="note-save-status" role="status" aria-live="polite">
            <strong>{operation === 'saving' ? 'Saving…' : operation === 'deleting' ? 'Deleting…' : dirty ? 'Unsaved changes' : editor.page ? 'All changes saved' : 'New page · not saved'}</strong>
            <p className="muted">Changes stay here until you choose Save page.</p>
          </div>
          <button type="button" className="button primary" disabled={busy || (!!editor.page && !dirty)} onClick={() => { void savePage() }}>
            {operation === 'saving' && <SaveSpinner />}
            {operation === 'saving' ? 'Saving…' : 'Save page'}
          </button>
        </footer>
      </section>
    </div>
  )
}
