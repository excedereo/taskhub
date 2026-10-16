import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DataProvider, SessionProvider } from './store.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { Layout } from './components/Layout.tsx'
import { LoginPage } from './pages/Login.tsx'
import { TasksPage } from './pages/Tasks.tsx'
import { UsersPage } from './pages/Users.tsx'
import { AnalyticsPage } from './pages/Analytics.tsx'
import { ArchivedPage } from './pages/Archived.tsx'
import { RolesPage } from './pages/Roles.tsx'
import { AuditPage } from './pages/Audit.tsx'
import { SettingsPage } from './pages/Settings.tsx'
import { ProfilePage } from './pages/Profile.tsx'
import { PreferencesPage } from './pages/Preferences.tsx'
import { initPrefs } from './prefs.ts'
import './styles.css'

initPrefs()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <DataProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<Layout />}>
                <Route index element={<Navigate to="/tasks" replace />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/tasks/c/:categoryId" element={<TasksPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/archived" element={<ArchivedPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/roles" element={<RolesPage />} />
                <Route path="/audit" element={<AuditPage />} />
                <Route path="/workspace" element={<SettingsPage />} />
                <Route path="/settings" element={<PreferencesPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="*" element={<Navigate to="/tasks" replace />} />
              </Route>
            </Routes>
          </DataProvider>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
