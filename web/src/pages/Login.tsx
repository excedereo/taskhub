import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api.ts'
import { useSession } from '../store.tsx'
import { useToast } from '../components/Toast.tsx'
import { BrandMark } from '../components/ui.tsx'

const ERRORS: Record<string, string> = {
  not_invited: 'Your Discord account has not been added to this team yet. Ask an admin to add you by your Discord user ID.',
  disabled: 'Your account has been disabled. Contact an admin if you think this is a mistake.',
  state: 'The sign-in link expired or was opened in another browser. Please try again.',
  discord: 'Discord did not let us in. Please try again in a moment.',
  not_configured: 'Discord sign-in is not configured on this server yet.',
}

function DiscordLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.61 1.25a18.27 18.27 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.88 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1 0-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.8 8.18 1.8 12.07 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1 0 .13c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .09.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42Z" />
    </svg>
  )
}

export function LoginPage() {
  const { me, meta, refreshMe } = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [devId, setDevId] = useState('')
  const [devName, setDevName] = useState('')

  if (me) return <Navigate to="/tasks" replace />
  if (!meta) return <div className="boot" />

  const error = params.get('error')

  const devSignIn = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/auth/dev', { discordId: devId, name: devName || undefined })
      await refreshMe()
      navigate('/tasks')
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <BrandMark logoUrl={meta.logoUrl} large />
        <h1>Sign in to {meta.instanceName}</h1>
        <p className="muted">
          {meta.needsSetup ? 'This instance is brand new. The first person to sign in becomes its owner.' : 'Use the Discord account your team added you with.'}
        </p>

        {error && <div className="notice notice-error">{ERRORS[error] ?? 'Sign-in failed. Please try again.'}</div>}

        {meta.discordConfigured ? (
          <a className="btn btn-discord btn-block" href="/api/auth/login">
            <DiscordLogo /> Continue with Discord
          </a>
        ) : (
          <div className="notice">
            Discord sign-in is not configured. Set <code>DISCORD_CLIENT_ID</code> and <code>DISCORD_CLIENT_SECRET</code> in <code>.env</code> and restart the server.
          </div>
        )}

        {meta.devLogin && (
          <form className="dev-login" onSubmit={devSignIn}>
            <p className="field-label">Development sign-in</p>
            <input className="input" value={devId} onChange={(e) => setDevId(e.target.value)} placeholder="Any Discord ID, e.g. 100000000000000001" inputMode="numeric" />
            <input className="input" value={devName} onChange={(e) => setDevName(e.target.value)} placeholder="Display name (optional)" />
            <button className="btn btn-block" disabled={!devId}>
              Sign in without Discord
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
