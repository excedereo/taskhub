import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, UNAUTHORIZED_EVENT } from './api.ts'
import type { Category, Label, Me, Meta, Role, User } from './types.ts'

type Session = {
  meta: Meta | null
  me: Me | null | undefined // undefined while loading
  refreshMe: () => Promise<void>
  refreshMeta: () => Promise<void>
  signOut: () => Promise<void>
}

type Data = {
  users: User[]
  roles: Role[]
  categories: Category[]
  labels: Label[]
  labelById: Map<number, Label>
  reloadLabels: () => Promise<void>
  userById: Map<number, User>
  roleById: Map<number, Role>
  categoryById: Map<number, Category>
  reloadUsers: () => Promise<void>
  reloadRoles: () => Promise<void>
  reloadCategories: () => Promise<void>
  can: (perm: string) => boolean
  /** Create permission plus the role's category limit (admins are never limited). */
  canCreateIn: (categoryId: number) => boolean
}

const SessionContext = createContext<Session | null>(null)
const DataContext = createContext<Data | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [me, setMe] = useState<Me | null | undefined>(undefined)

  const refreshMe = useCallback(async () => {
    setMe(await api.get<Me>('/me').catch(() => null))
  }, [])

  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {})
    setMe(null)
  }, [])

  const refreshMeta = useCallback(async () => {
    const m = await api.get<Meta>('/meta')
    setMeta(m)
    document.title = m.instanceName
    // The uploaded logo doubles as the browser tab icon.
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) {
      icon.href = m.logoUrl ?? '/favicon.svg'
      icon.type = m.logoUrl ? '' : 'image/svg+xml'
    }
  }, [])

  useEffect(() => {
    refreshMeta()
    refreshMe()
    const onUnauthorized = () => setMe(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [refreshMe, refreshMeta])

  const value = useMemo(() => ({ meta, me, refreshMe, refreshMeta, signOut }), [meta, me, refreshMe, refreshMeta, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { me } = useSession()
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [labels, setLabels] = useState<Label[]>([])

  const reloadUsers = useCallback(async () => setUsers(await api.get<User[]>('/users')), [])
  const reloadRoles = useCallback(async () => setRoles(await api.get<Role[]>('/roles')), [])
  const reloadCategories = useCallback(async () => setCategories(await api.get<Category[]>('/categories')), [])
  const reloadLabels = useCallback(async () => setLabels(await api.get<Label[]>('/labels')), [])

  useEffect(() => {
    if (!me) return
    reloadUsers()
    reloadRoles()
    reloadCategories()
    reloadLabels()
  }, [me, reloadUsers, reloadRoles, reloadCategories, reloadLabels])

  const can = useCallback(
    (perm: string) => Boolean(me && (me.permissions.includes('admin') || me.permissions.includes(perm))),
    [me],
  )

  const canCreateIn = useCallback(
    (categoryId: number) =>
      Boolean(me && (me.permissions.includes('admin') || (me.permissions.includes('create_tasks') && (me.createCategoryIds === null || me.createCategoryIds.includes(categoryId))))),
    [me],
  )

  const value = useMemo<Data>(
    () => ({
      users,
      roles,
      categories,
      labels,
      labelById: new Map(labels.map((l) => [l.id, l])),
      reloadLabels,
      userById: new Map(users.map((u) => [u.id, u])),
      roleById: new Map(roles.map((r) => [r.id, r])),
      categoryById: new Map(categories.map((c) => [c.id, c])),
      reloadUsers,
      reloadRoles,
      reloadCategories,
      can,
      canCreateIn,
    }),
    [users, roles, categories, labels, reloadUsers, reloadRoles, reloadCategories, reloadLabels, can, canCreateIn],
  )
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData outside DataProvider')
  return ctx
}

/** The signed-in user. Only call inside the authenticated layout. */
export function useMe() {
  const { me } = useSession()
  if (!me) throw new Error('useMe outside authenticated layout')
  return me
}
