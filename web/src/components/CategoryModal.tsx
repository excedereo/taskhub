import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import type { Category } from '../types.ts'
import { ConfirmButton, Field, Modal } from './ui.tsx'
import { AutoTextarea } from './AutoTextarea.tsx'
import { useToast } from './Toast.tsx'

export function CategoryModal({ category, onClose, onArchivedDone }: { category?: Category; onClose: () => void; onArchivedDone?: () => void }) {
  const { reloadCategories, can } = useData()
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const canDeleteFull = can('manage_categories') && can('delete_categories')

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      await reloadCategories()
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      if (category) {
        await api.patch(`/categories/${category.id}`, { name, description })
      } else {
        const created = await api.post<Category>('/categories', { name, description })
        navigate(`/tasks/c/${created.id}`)
      }
    })
  }

  return (
    <Modal
      title={category ? 'Edit category' : 'New category'}
      onClose={onClose}
      footer={
        <>
          {category && (
            <div className="modal-foot-left row gap-xs">
              {category.doneCount > 0 && (can('manage_categories') || can('edit_tasks')) && (
                <ConfirmButton disabled={busy} confirmText={`Archive ${category.doneCount} done?`} onConfirm={() => run(async () => {
                  const { archived } = await api.post<{ archived: number }>(`/categories/${category.id}/archive-done`)
                  toast.info(`Archived ${archived} finished task(s)`)
                  onArchivedDone?.()
                })}>
                  Archive done ({category.doneCount})
                </ConfirmButton>
              )}
              {category.totalCount === 0 ? (
                <ConfirmButton disabled={busy} onConfirm={() => run(async () => {
                  await api.del(`/categories/${category.id}`)
                  navigate('/tasks')
                })}>
                  Delete
                </ConfirmButton>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(() => api.patch(`/categories/${category.id}`, { archived: !category.archived }))}>
                    {category.archived ? 'Unarchive category' : 'Archive category'}
                  </button>
                  {canDeleteFull && !deleting && (
                    <button type="button" className="btn btn-ghost btn-danger-text" disabled={busy} onClick={() => setDeleting(true)}>
                      Delete…
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="category-form" className="btn btn-primary" disabled={busy || !name.trim()}>
            {category ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      {deleting && category && (
        <div className="danger-zone">
          <p>
            This permanently deletes <b>{category.totalCount} task(s)</b> in this category, including subtasks and archived ones, together with their images and
            history. It cannot be undone; the audit log keeps one entry about it.
          </p>
          <Field label={`Type “${category.name}” to confirm`}>
            <input className="input" autoFocus value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Category name" />
          </Field>
          <div className="row gap-xs">
            <button type="button" className="btn btn-ghost" onClick={() => (setDeleting(false), setConfirmName(''))}>
              Keep it
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || confirmName !== category.name}
              onClick={() => run(async () => {
                await api.del(`/categories/${category.id}?confirm=${encodeURIComponent(confirmName)}`)
                toast.info(`Deleted ${category.name}`)
                navigate('/tasks')
              })}
            >
              Delete category and tasks
            </button>
          </div>
        </div>
      )}
      <form id="category-form" className="form" onSubmit={submit}>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bug reports" maxLength={48} autoFocus />
        </Field>
        <Field label="Description" hint="Optional. Shown at the top of the category.">
          <AutoTextarea className="input" minRows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="What belongs here and how to file it" />
        </Field>
      </form>
    </Modal>
  )
}
