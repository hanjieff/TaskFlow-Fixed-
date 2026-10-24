import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { login, register } from './store'
import type { User } from './store'
import Icon from './Icon'

type Props = { mode: 'login' | 'signup'; onAuth: (user: User) => void }
export default function AuthPage({ mode, onAuth }: Props) {
  const signup = mode === 'signup'
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      const email = String(fields.get('email')), password = String(fields.get('password'))
      if (signup && password !== fields.get('confirmPassword')) throw new Error('Passwords do not match.')
      onAuth(signup ? await register(String(fields.get('name')), email, password) : await login(email, password))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in. Please try again.') }
    finally { setBusy(false) }
  }
  return <div className="auth-page">
    <aside className="auth-story">
      <Link className="brand" to="/login">
        <span className="brand-mark">t<span />
        </span>taskflow<span className="brand-period">.</span>
      </Link>
      <div className="story-copy">
        <div className="eyebrow">
          <span className="tiny-line" /> A LITTLE LESS CHAOS</div>
        <h1>Big ideas.<br />Small steps.<br />
          <span>Real progress.</span>
        </h1>
        <p>A home for your tasks, projects, and all the ideas in between. Make space for what matters.</p>
        <div className="auth-preview" aria-hidden="true">
          <div className="preview-heading">
            <span className="project-icon coral">
              <Icon name="folder" />
            </span>
            <div>
              <strong>Website launch</strong>
              <span>One step closer.</span>
            </div>
            <span className="preview-percent">75%</span>
          </div>
          <div className="preview-track">
            <span />
          </div>
          <div className="preview-task">
            <span className="preview-checkbox checked">
              <Icon name="check" size={12} />
            </span>
            <span>Find the right direction</span>
            <span className="badge done">Done</span>
          </div>
          <div className="preview-task">
            <span className="preview-checkbox checked">
              <Icon name="check" size={12} />
            </span>
            <span>Build something meaningful</span>
            <span className="badge done">Done</span>
          </div>
          <div className="preview-task">
            <span className="preview-checkbox" />
            <span>Share it with the world</span>
            <span className="badge progress">In progress</span>
          </div>
          <span className="preview-caption">Illustrative workspace preview</span>
        </div>
      </div>
      <div className="story-footnote">
        <span className="footnote-mark">
          <Icon name="leaf" size={18} />
        </span> A clear mind starts with a clear workspace.</div>
    </aside>
    <main className="auth-main">
      <div className="auth-top-note">Your work. Your space.</div>
      <div className="auth-form-wrap">
        <span className="auth-greeting">
          <Icon name={signup ? 'plus' : 'arrow'} size={24} />
        </span>
        <p className="eyebrow">LET’S GET INTO FLOW</p>
        <h2>{signup ? 'Start your next chapter.' : 'Welcome back.'}</h2>
        <p className="muted">{signup ? 'Create your account. Give your ideas a place to grow.' : 'Good to see you. Pick up where you left off.'}</p>
        <form onSubmit={submit} className="form-stack">
          {signup && <label>Full name<input name="name" autoComplete="name" required maxLength={60} placeholder="Your name" />
          </label>}
          <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" />
          </label>
          <label>Password<span className="password-field">
            <input name="password" aria-label="Password" type={showPassword ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : undefined} maxLength={128} placeholder={signup ? 'At least 8 characters' : 'Enter your password'} />
            <button type="button" className="password-toggle" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button>
          </span>
          </label>
          {signup && <label>Confirm password<input name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required maxLength={128} placeholder="Enter your password again" />
          </label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}<Icon name="arrow" size={18} />
          </button>
        </form>
        <p className="auth-switch">{signup ? 'Already have an account? ' : 'Don’t have an account? '}<Link to={signup ? '/login' : '/signup'}>{signup ? 'Sign in' : 'Sign up for free'}</Link>
        </p>
        <div className="auth-security">
          <Icon name="lock" size={16} />
          <span>Real accounts. Privately stored on this server.<br />Your password is hashed, never stored as plain text.</span>
        </div>
      </div>
      <div className="auth-bottom">TASKFLOW <span>Less busywork. More good work.</span>
      </div>
    </main>
  </div>
}
