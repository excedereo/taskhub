import { useEffect, useState, type DragEvent, type FormEvent } from 'react'
import { Hash } from 'lucide-react'
import { api, imageFiles, uploadImage } from '../api.ts'
import { useData, useMe } from '../store.tsx'
import { PRIORITIES, type Priority, type Task } from '../types.ts'
import { cx, displayName } from '../util.ts'
import { Avatar, Field, Modal, PriorityIcon } from './ui.tsx'
import { Select } from './Select.tsx'
import { AutoTextarea } from './AutoTextarea.tsx'
import { Gallery, type GalleryItem } from './Gallery.tsx'
import { useToast } from './Toast.tsx'
import { LabelPicker } from './LabelPicker.tsx'

type Draft = { key: string; file: File; url: string; width: number | null; height: number | null }
let draftSeq = 0

export function NewTaskModal({ defaultCategoryId, onClose, onCreated }: { defaultCategoryId?: number; onClose: () => void; onCreated: (task: Task) => void }) {
  const me = useMe()
  const { categories, users, can, canCreateIn, reloadCategories } = useData()
  const toast = useToast()
  const active = categories.filter((c) => !c.archived && canCreateIn(c.id))

  const [categoryId, setCategoryId] = useState(defaultCategoryId && active.some((c) => c.id === defaultCategoryId) ? defaultCategoryId : (active[0]?.id ?? 0))
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [assigneeId, setAssigneeId] = useState<number | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [labelIds, setLabelIds] = useState<number[]>([])
  const [images, setImages] = useState<Draft[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  const canAssign = can('assign_tasks')
  const canTake = can('take_tasks')
  const assignable = canAssign ? users.filter((u) => u.status !== 'disabled') : users.filter((u) => u.id === me.id)

  // Images are kept locally until the task exists, then uploaded one by one.
  const addImages = (files: File[]) => {
    for (const file of files) {
      const key = `d${++draftSeq}`
      const url = URL.createObjectURL(file)
      setImages((list) => [...list, { key, file, url, width: null, height: null }])
      const img = new Image()
      img.onload = () => setImages((list) => list.map((d) => (d.key === key ? { ...d, width: img.naturalWidth, height: img.naturalHeight } : d)))
      img.src = url
    }
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFiles(e.clipboardData?.items)
      if (!files.length) return
      e.preventDefault()
      addImages(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // Free the preview URLs when the modal goes away.
  const [urls] = useState(() => new Set<string>())
  images.forEach((d) => urls.add(d.url))
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const task = await api.post<Task>('/tasks', { categoryId, title, description, priority, assigneeId, dueDate: dueDate || null, labelIds })
      // One at a time, so the images keep the order they were added in.
      let uploaded = 0
      for (const d of images) {
        try {
          await uploadImage(task.id, d.file)
          uploaded++
        } catch (err) {
          toast.error(err)
        }
      }
      reloadCategories()
      onCreated({ ...task, attachmentCount: uploaded })
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const gallery: GalleryItem[] = images.map((d) => ({ key: d.key, src: d.url, name: d.file.name, width: d.width, height: d.height, size: d.file.size, removable: true }))

  return (
    <Modal
      title="New task"
      width={600}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="task-form" className="btn btn-primary" disabled={busy || !title.trim() || !categoryId}>
            {busy && images.length ? 'Uploading…' : 'Create task'}
          </button>
        </>
      }
    >
      <form
        id="task-form"
        className={cx('form', dragging && 'form-dragging')}
        onSubmit={submit}
        onDragOver={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
        onDrop={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDragging(false)
          addImages(imageFiles(e.dataTransfer.files))
        }}
      >
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" maxLength={200} autoFocus />
        </Field>
        <Field label="Description">
          <AutoTextarea className="input" minRows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Steps to reproduce, context, links…" />
        </Field>
        <div className="form-row">
          <Field label="Category">
            <Select
              aria-label="Category"
              value={categoryId}
              onChange={setCategoryId}
              options={active.map((c) => ({ value: c.id, label: c.name, icon: <Hash size={14} className="muted" /> }))}
            />
          </Field>
          <Field label="Priority">
            <Select
              aria-label="Priority"
              value={priority}
              onChange={setPriority}
              options={PRIORITIES.map((p) => ({ value: p.key, label: p.label, icon: <PriorityIcon priority={p.key} /> }))}
            />
          </Field>
          {(canAssign || canTake) && (
            <Field label="Assignee">
              <Select
                aria-label="Assignee"
                value={assigneeId}
                onChange={setAssigneeId}
                options={[
                  { value: null, label: 'Unassigned', icon: <span className="avatar avatar-empty" style={{ width: 18, height: 18 }} /> },
                  ...assignable.map((u) => ({ value: u.id, label: u.id === me.id ? `${displayName(u)} (me)` : displayName(u), icon: <Avatar user={u} size={18} /> })),
                ]}
              />
            </Field>
          )}
        </div>
        <div className="form-row">
          <Field label="Due date">
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <div className="field">
            <span className="field-label">Labels</span>
            <LabelPicker value={labelIds} onChange={setLabelIds} variant="default" />
          </div>
        </div>
        <div className="field">
          <span className="field-label">Images</span>
          <Gallery items={gallery} rowHeight={96} onAdd={addImages} onRemove={(item) => setImages((list) => list.filter((d) => d.key !== item.key))} />
          <span className="field-hint">Paste a screenshot with Ctrl+V or drop images here.</span>
        </div>
      </form>
    </Modal>
  )
}
