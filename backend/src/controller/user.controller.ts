import { Request, Response } from 'express';
import BankChangeRequest from '../model/bankChangeRequest.model.js';
import { OWNER_CONSOLE_ONLY } from '../middlewares/ownerConsoleOnly.js';
import { sendOwnerMail } from '../owner/owner.service.js';
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

// PATCH /api/auth/update/:id
// Only your own password can be changed here (an admin needs the current password too). Everything else about
// a person (name, email, position, company, role, status, approver rights, pay and bank details) is changed by
// Sir Simo in the Owner Console; employees ask for new bank details with POST /api/auth/bank-details/request.
const OWNER_FIELDS = ['name', 'email', 'position', 'companyId', 'status', 'role', 'canApproveDeliverables',
    'salaryAmount', 'salaryCurrency', 'sallaryCurrency', 'salaryAllowances', 'bankDetails'];

export const updateController = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const id = paramId(req);
    const b = req.body ?? {};
    const admin = isAdmin(auth);

    if (id !== auth.id || OWNER_FIELDS.some(f => b[f] !== undefined)) {
        throw forbidden(admin
            ? OWNER_CONSOLE_ONLY
            : 'Your name, email, position and pay details are changed by the owner. For new bank details, use "Request a change".');
    }

    const user = await User.findById(id).select('+password');
    if (!user) throw notFound('Employee not found');

    const wantsPassword = typeof b.password === 'string' && b.password.trim() !== '';
    if (!wantsPassword) throw badRequest('Nothing to change');
    // An admin account's password is a key to the owner's data: the current password is required.
    if (user.role === 'admin') await assertCurrentPassword(user, b.currentPassword);

    // The save hook hashes it and sets passwordChangedAt, which signs out every other session of this account.
    user.password = readNewPassword(b.password);
    await user.save();

    const { password: _password, ...safe } = user.toObject();
    res.status(200).json({
        success: true,
        message: 'Password changed',
        data: safe,
        token: generateToken({ id: String(user._id), role: user.role }),
    });
};

// GET /api/auth/bank-details   (own) the current details (account number and IBAN shortened) and any pending request
export const getMyBankDetails = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const user = await User.findById(auth.id).select('+bankDetails').lean();
    if (!user) throw notFound('Account not found');
    const short = (v?: string) => (v ? `${'•'.repeat(Math.max(0, Math.min(8, v.length - 4)))}${v.slice(-4)}` : '');
    const b = user.bankDetails ?? {};
    const pending = await BankChangeRequest.findOne({ employeeId: auth.id, status: 'pending' }).sort({ createdAt: -1 }).lean();
    const last = await BankChangeRequest.findOne({ employeeId: auth.id, status: { $in: ['approved', 'rejected'] } }).sort({ decidedAt: -1 }).lean();
    res.json({
        success: true,
        data: {
            current: { method: b.method ?? '', bankName: b.bankName ?? '', holderName: b.holderName ?? '', accountNumber: short(b.accountNumber), iban: short(b.iban) },
            pending: pending ? { requestedAt: pending.createdAt, bankName: pending.requested?.bankName ?? '', holderName: pending.requested?.holderName ?? '', iban: short(pending.requested?.iban), accountNumber: short(pending.requested?.accountNumber) } : null,
            lastDecision: last ? { status: last.status, decidedAt: last.decidedAt } : null,
        },
    });
};

// POST /api/auth/bank-details/request   (own) ask for new bank details; the current ones stay in use until approved
export const requestBankDetailsChange = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const details: { method?: string; bankName?: string; holderName?: string; accountNumber?: string; iban?: string } = parseBankDetails(req.body ?? {}) ?? {};
    if (!details.iban && !details.accountNumber) throw badRequest('Enter the IBAN or the account number');
    if (!details.holderName) throw badRequest('Enter the account holder name');
    await BankChangeRequest.updateMany({ employeeId: auth.id, status: 'pending' }, { $set: { status: 'replaced', decidedAt: new Date() } });
    await BankChangeRequest.create({ employeeId: new Types.ObjectId(auth.id), requested: details, status: 'pending' });
    const user = await User.findById(auth.id).select('name').lean();
    sendOwnerMail('Owner Console: new bank details request', [
        `${user?.name ?? 'An employee'} asked to change their bank details.`,
        '',
        'Open the Owner Console (People > Requests) to review it. Confirm the new details with the employee by phone before approving.',
    ]).catch(e => console.error('[bank request] owner email failed:', e instanceof Error ? e.message : e));
    res.status(201).json({ success: true, message: 'Request sent. Your current bank details stay in use until it is approved.' });
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
