# Time to editable: what was measured and kept

Production build, 4× CPU throttling, 1440 × 900 Chromium. Fixtures: 20 KB and
300 KB Markdown with four comments and three suggestions. Ten interleaved
before/after pairs; medians. "Load" is navigation to `data-phase="live"` plus
settling; "typing" is ten characters near the top of the document.

## Where the time went

- **Load.** Style recalculation was two thirds of main-thread time on the long
  document. The page has about 9,800 elements, but each full style pass made
  86,000 to 237,000 styles: 43 unscoped `::highlight()` rules each cost one
  style per element, whether or not that highlight was on the page. `:has()`
  rules looked suspicious and were ruled out by removing them in a probe.
- **Typing.** Every keystroke committed React 7 times and rendered the document
  page 3 times: a synchronous provenance push, a document tick, and repeated
  size and anchor updates with nothing new in them.

## Kept

| Count or time | 20 KB | 300 KB |
| --- | --- | --- |
| Element styles computed on load | 176,947 → 10,164 (−94%) | 1,033,236 → 55,120 (−95%) |
| Main-thread time to live | 2,185 → 1,423 ms (−35%) | 7,027 → 2,815 ms (−60%) |
| Long-task time to live | 1,595 → 850 ms (−47%) | 5,669 → 2,027 ms (−64%) |
| Element styles while typing | 908 → 304 (−67%) | 1,041 → 494 (−53%) |
| React commits, ten keys | 70 → 40 (−43%) | 70 → 40 (−43%) |
| Component renders, ten keys | 1,617 → 1,020 (−37%) | 1,617 → 1,020 (−37%) |
| Main-thread time, ten keys | 442 → 374 ms (−15%) | 1,552 → 1,367 ms (−12%) |

Every row moved the same way in 10 of 10 pairs. A run with two identical builds
moved no load count or time by more than 5%. Two earlier 10-pair runs of the
same changes, before rebasing and with the dropped change below, agreed.

The number of style passes while typing the long document rose from 30 to 34.5
for ten keys, while the elements styled in them halved.

## Dropped

- **Caching rendered block text in suggestion matching:** −9.8% script and
  −7.7% task time while typing in the long document, 3.3% fewer function calls.
  Real in 5 of 5 pairs, but under the 20% bar.

## Not measured

Firefox and WebKit performance. The gated rules were checked to paint the same
in both, in both themes.
