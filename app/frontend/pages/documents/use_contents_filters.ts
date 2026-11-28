import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DocLink } from './document_lists'

const EARLIER_PREVIEW_LIMIT = 8

/** Contents filters: tag and search combine (AND). */
export function useContentsFilters(yours: DocLink[]) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Text typed before hydration is in the DOM but not in state; take it up
  // before the next render writes the empty state over it.
  const searchRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (searchRef.current?.value) setQuery(searchRef.current.value)
  }, [])
  const [showAllEarlier, setShowAllEarlier] = useState(false)
  const availableTags = yours.reduce<string[]>((tags, document) => {
    document.tags.forEach((tag) => {
      if (!tags.some((existingTag) => existingTag.toLowerCase() === tag.toLowerCase())) {
        tags.push(tag)
      }
    })
    return tags
  }, [])
  const activeTag = availableTags.includes(selectedTag ?? '') ? selectedTag : null
  const needle = query.trim().toLowerCase()
  const filterActive = activeTag !== null || needle !== ''
  const visibleDocuments = yours.filter((document) => {
    if (activeTag && !document.tags.some((tag) => tag.toLowerCase() === activeTag.toLowerCase())) {
      return false
    }
    if (!needle) return true
    return (
      document.title.toLowerCase().includes(needle) ||
      document.tags.some((tag) => tag.toLowerCase().includes(needle))
    )
  })
  const thisWeek = visibleDocuments.filter((document) => document.age_group === 'this_week')
  const earlier = visibleDocuments.filter((document) => document.age_group === 'earlier')
  const visibleEarlier =
    showAllEarlier || filterActive ? earlier : earlier.slice(0, EARLIER_PREVIEW_LIMIT)
  const hiddenEarlierCount = earlier.length - visibleEarlier.length
  const clearFilters = () => {
    setSelectedTag(null)
    setQuery('')
  }

  // On a phone the Contents page sits below the left page: bring its heading
  // into view when a filter changes so results are never off-screen.
  const contentsHeadingRef = useRef<HTMLHeadingElement>(null)
  const filtersTouched = useRef(false)
  useEffect(() => {
    if (!filtersTouched.current) return
    if (window.matchMedia('(max-width: 56rem)').matches) {
      contentsHeadingRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [activeTag, needle])
  const touchFilters = () => {
    filtersTouched.current = true
  }

  return {
    searchRef,
    contentsHeadingRef,
    query,
    setQuery,
    setSelectedTag,
    setShowAllEarlier,
    availableTags,
    activeTag,
    needle,
    filterActive,
    visibleDocuments,
    thisWeek,
    visibleEarlier,
    hiddenEarlierCount,
    clearFilters,
    touchFilters,
  }
}
