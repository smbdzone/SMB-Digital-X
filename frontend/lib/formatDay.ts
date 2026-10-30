// Dates picked in <input type="date"> are stored by the backend as UTC midnight.
// Showing them in UTC keeps the day the admin picked, whatever the viewer's timezone is.

export const formatDay = (date?: string | null) => {
    if (!date) return '-'
    const d = new Date(date)
    if (Number.isNaN(d.getTime())) return '-'
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// ISO string -> "YYYY-MM-DD" for <input type="date">
export const toDateInput = (date?: string | null) => {
    if (!date) return ''
    const d = new Date(date)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}
