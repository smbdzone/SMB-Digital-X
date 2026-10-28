import { Types } from 'mongoose'
import Company from '../model/company.model.js'
import User from '../model/user.model.js'
import { badRequest, isObjectId } from '../utils/http.js'

/**
 * Logos are stored as either an absolute URL (e.g. Cloudinary) or a path served by the
 * frontend ("/images/axis-aura.png"). Resolve at render time instead of saving a full URL
 * on every salary record, so changing FRONTEND later does not break old records.
 *
 * Remember: email clients load the logo from the internet, so this must be a PUBLIC url
 * (http://localhost:3000/... will not show up in a real inbox).
 */
export const resolveLogoUrl = (logo?: string | null): string => {
    if (!logo) return ''
    if (/^https?:\/\//i.test(logo)) {
        return logo
    };
    return logo;

}

// const base = (process.env.FRONTEND || '').replace(/\/+$/, '')
// return base ? `${base}${logo.startsWith('/') ? '' : '/'}${logo}` : ''

/** Adds `logoUrl` to a company object for API responses. */
export const withLogoUrl = <T extends { logo?: string }>(company: T): T & { logoUrl: string } => ({
    ...company,
    logoUrl: resolveLogoUrl(company.logo),
})

/**
 * Picks the company for a new record: the explicit one from the request, otherwise the
 * employee's own company. Throws a 400 if it is missing, unknown or inactive.
 */
export const resolveActiveCompanyId = async (input: unknown, fallbackUserId?: string): Promise<Types.ObjectId> => {
    let id: unknown = input

    if ((id === undefined || id === null || id === '') && fallbackUserId) {
        const user = await User.findById(fallbackUserId).select('companyId').lean()
        id = user?.companyId ? String(user.companyId) : undefined
    }

    if (!isObjectId(id)) throw badRequest('companyId is required (no default company is assigned to this user)')

    const company = await Company.findOne({ _id: id, isActive: true }).select('_id').lean()
    if (!company) throw badRequest('Company not found or inactive')
    return company._id as Types.ObjectId
}
