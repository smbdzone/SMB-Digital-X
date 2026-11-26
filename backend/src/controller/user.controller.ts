import { Request, Response } from 'express';
import User from '../model/user.model.js';
import jwt from 'jsonwebtoken'
import { Types } from 'mongoose';
import { resolveActiveCompanyId } from '../services/company.service.js';
import { asAmount, asCurrency, asEmail, asLineItems, asText, badRequest, forbidden, getAuth, isAdmin, notFound, paramId } from '../utils/http.js';


type LineItem = { name: string; amount: number };

/** Mongoose subdocuments -> plain { name, amount } objects (safe to compare and copy). */
const plainLineItems = (items?: LineItem[] | null): LineItem[] =>
    (items ?? []).map(a => ({ name: a.name, amount: a.amount }));

const sameLineItems = (a: LineItem[], b: LineItem[]): boolean =>
    a.length === b.length && a.every((item, i) => item.name === b[i].name && item.amount === b[i].amount);

const generateToken =({ id, role }: { id: string, role: string }): string => {
    return jwt.sign({ id: id, role: role },
        process.env.JWT_SECRET!,
        { expiresIn: '30d' })
}

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128

const readNewPassword = (value: unknown): string => {
    if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    if (value.length > MAX_PASSWORD_LENGTH) throw badRequest(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
    return value
}

/** 400 unless `current` is the account's password. The account must be loaded with +password. */
const assertCurrentPassword = async (user: { comparePassword(p: string): Promise<boolean> }, current: unknown) => {
    if (typeof current !== 'string' || !current) throw badRequest('Enter your current password')
    // 400, not 401: a 401 would make the app sign the user out.
    if (!await user.comparePassword(current)) throw badRequest('Current password is incorrect')
}

// POST /api/auth/change-password   { currentPassword, newPassword }   (signed in, own account only)
// Every other session of this account is signed out; this one gets a fresh token in the answer.
export const changePasswordController = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const user = await User.findById(auth.id).select('+password');
    if (!user) throw notFound('Account not found');

    await assertCurrentPassword(user, b.currentPassword);
    const newPassword = readNewPassword(b.newPassword);
    if (await user.comparePassword(newPassword)) throw badRequest('The new password must be different from the current one');

    user.password = newPassword;
    await user.save();   // the save hook hashes it and sets passwordChangedAt

    res.status(200).json({
        success: true,
        message: 'Password changed. Other devices have been signed out.',
        data: { token: generateToken({ id: String(user._id), role: user.role }) },
    });
};

// Creates an employee (admin only - see user.routes.ts). Salary and company are set here.
export const registerController = async (req: Request, res: Response): Promise<void> => {
    const b = req.body ?? {};

    const name = asText(b.name, 'name', { required: true, max: 100 });
    const email = asEmail(b.email, 'email');
    const password = typeof b.password === 'string' ? b.password : '';
    if (!email) throw badRequest('name , email, password is required');
    if (!password.trim()) throw badRequest('name , email, password is required');

    if (await User.findOne({ email })) throw badRequest('email already registered');

    // `sallaryCurrency` (old typo) is still accepted so existing frontends keep working.
    const salaryCurrency = b.salaryCurrency ?? b.sallaryCurrency;

    const newUser = new User({
        name,
        email,
        password,
        position: asText(b.position, 'position', { max: 100 }) ?? '',
        companyId: b.companyId ? await resolveActiveCompanyId(b.companyId) : undefined,
        salary: {
            amount: b.salaryAmount !== undefined ? asAmount(b.salaryAmount, 'salaryAmount') : undefined,
            currency: salaryCurrency !== undefined ? asCurrency(salaryCurrency, 'salaryCurrency') : 'AED',
            allowances: b.salaryAllowances !== undefined ? asLineItems(b.salaryAllowances, 'salaryAllowances') : [],
            effectiveFrom: new Date(),
        },
        bankDetails: parseBankDetails(b.bankDetails),
    });

    await newUser.save();
    res.status(200).json({
        success: true,
        message: 'New employee registered'
    });
}


export const loginController = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        // req.body is undefined when no JSON body was sent; anything but two non-empty strings is a bad request.
        const email = req.body?.email;
        const password = req.body?.password;

        if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
            res.status(400).json({
                success: false,
                message: "Email & password are required",
            });
            return;
        }

        const exist = await User.findOne({ email });

        if (!exist) {
            res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
            return;
        }

        if (exist.status === "inactive") {
            res.status(403).json({
                success: false,
                message: "Inactive account. Contact the manager.",
            });
            return;
        }

        const compare = await exist.comparePassword(password);

        if (!compare) {
            res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
            return;
        }

        const token = await generateToken({
            id: String(exist._id),
            role: exist.role,
        });

        res.status(200).json({
            success: true,
            message: "Login successful",
            data: {
                token,
                user: {
                    id: String(exist._id),
                    name: exist.name,
                    email: exist.email,
                    role: exist.role,
                    canApproveDeliverables: exist.role === 'admin' || exist.canApproveDeliverables === true,
                },
            },
        });
    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "Server error during login",
        });
    }
};

const parseBankDetails = (value: unknown) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'object') throw badRequest('bankDetails must be an object');
    const v = value as Record<string, unknown>;
    return {
        method: asText(v.method, 'bankDetails.method', { max: 50 }),
        bankName: asText(v.bankName, 'bankDetails.bankName', { max: 100 }),
        holderName: asText(v.holderName, 'bankDetails.holderName', { max: 100 }),
        accountNumber: asText(v.accountNumber, 'bankDetails.accountNumber', { max: 50 }),
        iban: asText(v.iban, 'bankDetails.iban', { max: 50 }),
    };
};

// Admin: can update anyone, including salary / status / company.
// Employee: can only update their own name, email, position, password and bank details.
export const updateController = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const id = paramId(req);
    const admin = isAdmin(auth);

    if (!admin && id !== auth.id) throw forbidden('You can only update your own profile');

    // Loaded as a document and saved (not findByIdAndUpdate) so the password-hashing hook runs.
    // The old code saved changed passwords in PLAIN TEXT because updates skip that hook.
    const user = await User.findById(id).select('+bankDetails +password');
    if (!user) throw notFound('Employee not found');

    const b = req.body ?? {};
    const self = id === auth.id;

    // An admin account's password and email are the keys to the owner's data: only that account
    // itself can change them, and only with its current password. (Email recovery is off for admins.)
    const wantsPassword = typeof b.password === 'string' && b.password.trim() !== '';
    const wantsEmail = b.email !== undefined
        && String(b.email).trim().toLowerCase() !== String(user.email ?? '').toLowerCase();
    if (user.role === 'admin' && (wantsPassword || wantsEmail)) {
        if (!self) throw forbidden("Only the account owner can change an admin's password or email");
        await assertCurrentPassword(user, b.currentPassword);
    }

    if (b.name !== undefined) user.name = asText(b.name, 'name', { required: true, max: 100 });
    if (b.position !== undefined) user.position = asText(b.position, 'position', { max: 100 }) ?? '';

    if (wantsEmail) {
        const email = asEmail(b.email, 'email');
        if (!email) throw badRequest('email is required');
        if (await User.findOne({ email, _id: { $ne: user._id } })) throw badRequest('email already registered');
        user.email = email;
    }

    // The save hook sets passwordChangedAt, which signs out every session of this account.
    if (wantsPassword) user.password = readNewPassword(b.password);

    if (b.bankDetails !== undefined) {
        const current = (user.bankDetails as any)?.toObject?.() ?? user.bankDetails ?? {};
        const incoming = parseBankDetails(b.bankDetails) ?? {};
        // only overwrite the fields that were actually sent
        user.bankDetails = { ...current, ...Object.fromEntries(Object.entries(incoming).filter(([, v]) => v !== undefined)) };
    }

    if (admin) {
        if (b.status !== undefined) {
            if (b.status !== 'active' && b.status !== 'inactive') throw badRequest("status must be 'active' or 'inactive'");
            user.status = b.status;
        }
        if (b.companyId !== undefined) user.companyId = b.companyId ? await resolveActiveCompanyId(b.companyId) : undefined;
        if (b.canApproveDeliverables !== undefined) {
            if (typeof b.canApproveDeliverables !== 'boolean') throw badRequest('canApproveDeliverables must be true or false');
            user.canApproveDeliverables = b.canApproveDeliverables;
        }

        const newAmount = b.salaryAmount !== undefined ? asAmount(b.salaryAmount, 'salaryAmount') : undefined;
        const newCurrency = (b.salaryCurrency ?? b.sallaryCurrency) !== undefined
            ? asCurrency(b.salaryCurrency ?? b.sallaryCurrency, 'salaryCurrency')
            : undefined;

        const newAllowances = b.salaryAllowances !== undefined ? asLineItems(b.salaryAllowances, 'salaryAllowances') : undefined;
        const currentAllowances = plainLineItems(user.salary?.allowances);

        const amountChanged = newAmount !== undefined && newAmount !== user.salary?.amount;
        const currencyChanged = newCurrency !== undefined && newCurrency !== user.salary?.currency;
        const allowancesChanged = newAllowances !== undefined && !sameLineItems(newAllowances, currentAllowances);

        if (amountChanged || currencyChanged || allowancesChanged) {
            // Keep the old value so there is always a record of what the salary used to be.
            if (typeof user.salary?.amount === 'number') {
                user.salaryHistory.push({
                    amount: user.salary.amount,
                    currency: user.salary.currency,
                    allowances: currentAllowances,
                    effectiveFrom: user.salary.effectiveFrom,
                    changedBy: new Types.ObjectId(auth.id),
                    changedAt: new Date(),
                });
            }
            user.set('salary.amount', newAmount ?? user.salary?.amount);
            user.set('salary.currency', newCurrency ?? user.salary?.currency);
            user.set('salary.allowances', newAllowances ?? currentAllowances);
            user.set('salary.effectiveFrom', new Date());
        }
    } else if (b.status !== undefined || b.companyId !== undefined || b.salaryAmount !== undefined || b.salaryCurrency !== undefined || b.salaryAllowances !== undefined || b.canApproveDeliverables !== undefined) {
        throw forbidden('Only an admin can change status, company, salary or approver rights');
    }

    await user.save();

    const { password: _password, ...safe } = user.toObject();
    res.status(200).json({
        success: true,
        message: "Employee profile updated",
        data: safe,
        // Changing your own password signs out your other sessions; this one continues with a fresh token.
        ...(self && wantsPassword ? { token: generateToken({ id: String(user._id), role: user.role }) } : {}),
    });
};


export const getUserController = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.user.id
        const profile = await User.findById(id).select('-password').lean()

        if (profile?.status === 'inactive') {
            res.status(400).json({
                success: false,
                message: 'Employee inActive.'
            })
            return;
        };

        res.status(200).json({
            success: true,
            message: 'User profile fetched',
            data: profile
        })

    } catch (error) {
        console.error('register error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during register'
        });
    }
}


export const getAllUserController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id, role } = req.user;
        // Employees use this list for chat only: they get names and contact fields, never salary or other HR data.
        const fields = role === 'admin' ? "-password" : "_id name email position";
        const Users = await User.find({
            _id: { $ne: id }
        }).select(fields).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            message: 'All users fetched',
            data: Users
        });

    } catch (error) {
        console.error('register error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during register'
        });
    }
}


export const deleteUserController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const deleteUser = await User.findByIdAndDelete(id)
        if (!deleteUser) {
            res.status(400).json({
                success: false,
                message: 'User not deleted'
            })
        }

        res.status(200).json({
            success: true,
            message: 'users deleted',
        });

    } catch (error) {
        console.error('register error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during register'
        });
    }
}
