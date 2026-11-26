# Less server work in agent document writes and batch accept

100 calls (20 KB and 300 KB documents, Markdown and HTML, with 300 pending update rows, 200 comments, 100 suggestions, 400 provenance spans), counted on main and on the branch. Main was counted twice and the branch twice; totals differed by 2 allocations.

| Over all 100 calls | main | branch | change |
|---|---|---|---|
| Allocations | 4,860,560 | 4,082,619 | -16% |
| Markdown renders and HTML parses | 120 | 78 | -35% |
| Queries | 1,542 | 1,306 | -15% |

| Lever (cumulative) | Allocations | Parses | Queries |
|---|---|---|---|
| Reuse one parse of a written document | 4,524,791 | 92 | 1,542 |
| Skip metadata work on elements without metadata | 4,173,916 | 92 | 1,542 |
| Look for uploaded images only where one can be | 4,114,376 | 78 | 1,542 |
| Accept a batch without reloading every row | 4,082,617 | 78 | 1,306 |

All four met the 1% keep threshold on at least one objective. Forecasts were the measured shares of each stage; results stayed within them. Holdout: none, so selection and reporting share one set of calls. An emptied plain_text failed the identity check, as it should.

Checks: 1,140 responses, with broadcasts and stored rows, identical to main at every step. Six processes racing accept, reject and batch accept: 1,500 resolves, no duplicate, lost or mismatched row, on main and on the branch.

Left alone: the document read (its cost is walking text nodes once), suggestion, comment and presence writes (a 300 KB document costs about the same as a 20 KB one), the repeated row reload under the document lock and the fold (no measured gain worth a locking change), and the gem sanitizer, now the largest part of an HTML write.
