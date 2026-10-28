// Money helpers. All arithmetic is done in integer cents so 0.1 + 0.2 style
// floating point errors never reach the database. Values are still stored and
// returned in normal units (e.g. 125.50), so the frontend contract is unchanged.

export const toCents = (value: number): number => Math.round((value + Number.EPSILON) * 100)

export const fromCents = (cents: number): number => cents / 100

export const round2 = (value: number): number => fromCents(toCents(value))

export const sumMoney = (values: number[]): number =>
    fromCents(values.reduce((total, v) => total + toCents(v), 0))
