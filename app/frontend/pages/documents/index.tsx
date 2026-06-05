import { Head, Link, useForm } from '@inertiajs/react'

interface Props {
  recent: { title: string; slug: string }[]
}

export default function DocumentsIndex({ recent }: Props) {
  const { post, processing } = useForm({})

  return (
    <>
      <Head title="Proof" />
      <div className="landing">
        <main className="landing-main">
          <h1 className="landing-wordmark">Proof</h1>
          <p className="landing-tagline">
            A collaborative editor that remembers who wrote what — humans and AI,
            side by side, every word attributed.
          </p>
          <div className="landing-actions">
            <button
              className="btn btn-primary"
              disabled={processing}
              onClick={() => post('/documents')}
            >
              New document
            </button>
            {recent.some((d) => d.slug === 'demo') && (
              <Link href="/d/demo" className="btn btn-ghost" prefetch>
                Open the demo
              </Link>
            )}
          </div>
          {recent.length > 0 && (
            <section className="landing-recent">
              <h2 className="landing-recent-heading">Recent</h2>
              <ul>
                {recent.map((doc) => (
                  <li key={doc.slug}>
                    <Link href={`/d/${doc.slug}`} prefetch>
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </>
  )
}
