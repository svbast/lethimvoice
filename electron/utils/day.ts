// Local calendar day key, "YYYY-MM-DD": stats are "what the user did today",
// not UTC bookkeeping. Shared so renderer charts bucket days as
// electron/store/stats.ts wrote them. Pure data helper, no imports. Swedish dates
// read as ISO ones, in local time.
export const dayKey = (d: Date): string => d.toLocaleDateString('sv-SE')
