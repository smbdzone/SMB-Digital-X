/**
 * {{placeholders}} in letter and certificate texts. The frontend has the same rules in
 * frontend/services/certificate.services.ts: keep the two in step.
 *
 * A placeholder is {{name}}, with optional spaces inside the brackets, where the name starts with a
 * lowercase letter and is 2 to 40 letters, digits or underscores: {{employeeName}}, {{course_name}}.
 *
 * Old saved texts may use names that start with a capital letter ({{CourseName}}). Those are still
 * accepted, but only when they come from a stored text (`legacy`), never when typed fresh, so typing
 * a name such as {{Abbas}} inside the brackets is not mistaken for a new value to fill in.
 *
 * Anything else in double curly brackets, or a stray {{ or }}, is "broken" and blocks preview and issue,
 * so it can never be printed in a letter.
 */

export const PLACEHOLDER_NAME = /^[a-z][a-zA-Z0-9_]{1,39}$/
const LEGACY_NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/        // the rule before November 2026
const TOKEN = /\{\{([^{}]*)\}\}/g
const STRAY = /\{\{[^\s{}]{0,30}|[^\s{}]{0,30}\}\}/g

export interface PlaceholderScan {
    names: string[]     // valid placeholder names, in order of first use
    broken: string[]    // what was found instead, e.g. "{{Abbas Khan}}"
}

const isValid = (name: string, legacy: ReadonlySet<string>) => PLACEHOLDER_NAME.test(name) || legacy.has(name)

/** Names that only the old rule accepts. Taken from a stored text, they stay valid for that text. */
export const legacyNames = (...texts: (string | undefined)[]): string[] => {
    const found = new Set<string>()
    for (const text of texts) {
        for (const m of (text ?? '').matchAll(TOKEN)) {
            const name = m[1].trim()
            if (LEGACY_NAME.test(name) && !PLACEHOLDER_NAME.test(name)) found.add(name)
        }
    }
    return [...found]
}

export const scanPlaceholders = (texts: (string | undefined)[], legacy: Iterable<string> = []): PlaceholderScan => {
    const allowed = new Set(legacy)
    const names = new Set<string>()
    const broken = new Set<string>()

    for (const text of texts) {
        if (!text) continue
        const rest = text.replace(TOKEN, (all, inner: string) => {
            const name = inner.trim()
            if (isValid(name, allowed)) names.add(name)
            else broken.add(all.length > 44 ? `${all.slice(0, 40)}...}}` : all)
            return ' '
        })
        for (const m of rest.matchAll(STRAY)) broken.add(m[0])
    }
    return { names: [...names], broken: [...broken] }
}

export const brokenPlaceholderMessage = (broken: string[]): string =>
    `This text has ${broken.length === 1 ? 'a broken placeholder' : 'broken placeholders'}: ${broken.slice(0, 5).join(', ')}. `
    + 'Use {{employeeName}}, or type the text without curly brackets.'

/** Puts the values in. Call after scanPlaceholders found nothing broken. */
export const fillPlaceholders = (
    text: string, vars: Record<string, string>, legacy: Iterable<string> = [],
): { text: string; missing: string[] } => {
    const allowed = new Set(legacy)
    const missing = new Set<string>()
    const out = text.replace(TOKEN, (all, inner: string) => {
        const name = inner.trim()
        if (!isValid(name, allowed)) return all
        if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name]
        missing.add(name)
        return all
    })
    return { text: out, missing: [...missing] }
}
