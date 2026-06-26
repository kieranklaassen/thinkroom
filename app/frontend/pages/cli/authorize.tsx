import { Form, Head, Link } from '@inertiajs/react'
import '../auth/show.css'
import './authorize.css'

type Status = 'ready' | 'approved' | 'consumed' | 'expired' | 'invalid' | 'unavailable'

interface Props {
  status: Status
  user_code: string
  account: {
    name: string
    email: string
  }
}

const statusCopy: Record<Exclude<Status, 'ready'>, { title: string; body: string }> = {
  approved: {
    title: 'CLI connected',
    body: 'Approval is complete. You can return to your terminal.',
  },
  consumed: {
    title: 'CLI connected',
    body: 'This authorization has already been completed. You can close this page.',
  },
  expired: {
    title: 'Code expired',
    body: 'Run thinkroom login again to start a fresh connection.',
  },
  invalid: {
    title: 'Code not found',
    body: 'Check the link from your terminal or run thinkroom login again.',
  },
  unavailable: {
    title: 'Code unavailable',
    body: 'This connection was approved from another account. Start again from your terminal if needed.',
  },
}

export default function CliAuthorize({ status, user_code, account }: Props) {
  const ready = status === 'ready'
  const copy = ready
    ? {
        title: 'Connect Thinkroom CLI',
        body: `Approve access to ${account.name}’s Thinkroom account.`,
      }
    : statusCopy[status]

  return (
    <>
      <Head title={`${copy.title} · Thinkroom`} />
      <main className="auth-page">
        <section className="auth-card cli-auth-card" aria-labelledby="cli-auth-heading">
          <Link href="/" className="auth-wordmark" aria-label="Thinkroom home">
            T.
          </Link>

          <div className="auth-heading">
            <p className="cli-auth-eyebrow">Thinkroom CLI</p>
            <h1 id="cli-auth-heading">{copy.title}</h1>
            <p>{copy.body}</p>
          </div>

          <div className="cli-auth-code" aria-label={`Connection code ${user_code}`}>
            <span>Connection code</span>
            <strong>{user_code}</strong>
          </div>

          {ready ? (
            <>
              <div className="cli-auth-account">
                <span>Signed in as</span>
                <strong>{account.name}</strong>
                <small>{account.email}</small>
              </div>
              <Form method="post" action="/cli/authorize" disableWhileProcessing>
                {({ processing }) => (
                  <>
                    <input type="hidden" name="code" value={user_code} />
                    <button className="btn btn-primary cli-auth-submit" type="submit" disabled={processing}>
                      {processing ? 'Connecting…' : 'Approve connection'}
                    </button>
                  </>
                )}
              </Form>
              <p className="cli-auth-safety">
                This lets the CLI create documents in your account. It never receives your password or browser session.
              </p>
            </>
          ) : (
            <Link href="/" className="btn cli-auth-submit">
              Back to Thinkroom
            </Link>
          )}
        </section>
      </main>
    </>
  )
}
