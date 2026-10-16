import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import type { Category } from '../types.ts'
import { ConfirmButton, Field, Modal } from './ui.tsx'
import { AutoTextarea } from './AutoTextarea.tsx'
import { useToast } from './Toast.tsx'

export function CategoryModal({ category, onClose }: { category?: Category; onClose: () => void }) {
  const { reloadCategories } = useData()
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [busy, setBusy] = useState(false)

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
            <div className="modal-foot-left">
              {category.totalCount === 0 ? (
                <ConfirmButton disabled={busy} onConfirm={() => run(async () => {
                  await api.del(`/categories/${category.id}`)
                  navigate('/tasks')
                })}>
                  Delete
                </ConfirmButton>
              ) : (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(() => api.patch(`/categories/${category.id}`, { archived: !category.archived }))}>
                  {category.archived ? 'Unarchive' : 'Archive'}
                </button>
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
