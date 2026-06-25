import { Form, Head, Link } from '@inertiajs/react'
import './show.css'

interface Props {
  mode: 'login' | 'register'
  google_enabled: boolean
  csrf_token: string
  return_to: string | null
}

const errorText = (error: unknown): string | null => {
  if (Array.isArray(error)) return error.find((value) => typeof value === 'string') ?? null
  return typeof error === 'string' ? error : null
}

export default function AuthShow({ mode, google_enabled, csrf_token, return_to }: Props) {
  const registering = mode === 'register'
  const title = registering ? 'Create your account' : 'Welcome back'
  const switchPath = registering ? '/login' : '/signup'
  const switchHref = return_to
    ? `${switchPath}?${new URLSearchParams({ return_to }).toString()}`
    : switchPath

  return (
    <>
      <Head title={`${title} · Thinkroom`} />
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-heading">
          <Link href="/" className="auth-wordmark" aria-label="Thinkroom home">
            T.
          </Link>
          <div className="auth-heading">
            <h1 id="auth-heading">{title}</h1>
            <p>
              {registering
                ? 'Keep your documents with you across browsers.'
                : 'Continue thinking where you left off.'}
            </p>
          </div>

          {google_enabled && (
            <>
              <form method="post" action="/auth/google_oauth2">
                <input type="hidden" name="authenticity_token" value={csrf_token} />
                <button className="auth-google" type="submit">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.4 2.9-7.4Z" />
                    <path fill="#34a853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.6A10 10 0 0 0 12 22Z" />
                    <path fill="#fbbc05" d="M6.4 14a6 6 0 0 1 0-3.9V7.4H3a10 10 0 0 0 0 9.2L6.4 14Z" />
                    <path fill="#ea4335" d="M12 5.9c1.5 0 2.9.5 3.9 1.5l2.9-2.9A9.7 9.7 0 0 0 3 7.4l3.4 2.7C7.2 7.7 9.4 5.9 12 5.9Z" />
                  </svg>
                  Continue with Google
                </button>
              </form>
              <div className="auth-divider"><span>or</span></div>
            </>
          )}

          <Form method="post" action={registering ? '/signup' : '/login'} disableWhileProcessing>
            {({ errors, processing }) => (
              <div className="auth-fields">
                {registering && (
                  <label>
                    <span>Name</span>
                    <input name="name" type="text" autoComplete="name" required maxLength={255} autoFocus />
                  </label>
                )}
                <label>
                  <span>Email</span>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    autoFocus={!registering}
                    aria-invalid={Boolean(errors.email)}
                  />
                </label>
                <label>
                  <span>Password</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete={registering ? 'new-password' : 'current-password'}
                    required
                    minLength={10}
                    aria-invalid={Boolean(errors.email || errors.form)}
                  />
                </label>
                {registering && (
                  <label>
                    <span>Confirm password</span>
                    <input
                      name="password_confirmation"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={10}
                    />
                  </label>
                )}
                {(errorText(errors.email) || errorText(errors.form)) && (
                  <p className="auth-error" role="alert">
                    {errorText(errors.email) || errorText(errors.form)}
                  </p>
                )}
                <button className="btn btn-primary auth-submit" type="submit" disabled={processing}>
                  {processing ? 'Working…' : registering ? 'Create account' : 'Sign in'}
                </button>
              </div>
            )}
          </Form>

          <p className="auth-switch">
            {registering ? 'Already have an account?' : 'New to Thinkroom?'}{' '}
            <Link href={switchHref}>
              {registering ? 'Sign in' : 'Create one'}
            </Link>
          </p>
        </section>
      </main>
    </>
  )
}
