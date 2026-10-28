export const formatMoney = (amount: number | null | undefined) =>
    Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const formatCurrency = (amount: number | null | undefined, currency?: string) =>
    `${currency ? `${currency} ` : ''}${formatMoney(amount)}`

export const getTodayDate = () => {
    const date = new Date()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export const currentMonth = () => getTodayDate().slice(0, 7)

export const getDateOnly = (date: string) => {
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export const formatDate = (date?: string | null) =>
    date
        ? new Date(date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
        : '-'

export const formatDateTime = (date?: string | null) =>
    date
        ? new Date(date).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '-'

// "2026-10" -> "October 2026"
export const formatMonthLabel = (month: string) =>
    /^\d{4}-\d{2}$/.test(month)
        ? new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : month

// { a: 1, b: '', c: undefined } -> "?a=1"
export const buildQuery = (params: Record<string, string | number | boolean | null | undefined>) => {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
    })
    const query = search.toString()
    return query ? `?${query}` : ''
}

export const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback
