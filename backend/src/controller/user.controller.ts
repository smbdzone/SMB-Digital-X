import { Request, Response } from 'express';
import User from '../model/user.model.js';
import jwt from 'jsonwebtoken'
import { Types } from 'mongoose';
import { resolveActiveCompanyId } from '../services/company.service.js';
import { asAmount, asCurrency, asEmail, asText, badRequest, forbidden, getAuth, isAdmin, notFound, paramId } from '../utils/http.js';


const generateToken = ({ id, role }: { id: string, role: string }): string => {
    return jwt.sign({ id: id, role: role },
        process.env.JWT_SECRET!,
        { expiresIn: '30d' })
}

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
        const { email, password } = req.body;

        if (!email || !password) {
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
    const user = await User.findById(id).select('+bankDetails');
    if (!user) throw notFound('Employee not found');

    const b = req.body ?? {};

    if (b.name !== undefined) user.name = asText(b.name, 'name', { required: true, max: 100 });
    if (b.position !== undefined) user.position = asText(b.position, 'position', { max: 100 }) ?? '';

    if (b.email !== undefined) {
        const email = asEmail(b.email, 'email');
        if (!email) throw badRequest('email is required');
        if (await User.findOne({ email, _id: { $ne: user._id } })) throw badRequest('email already registered');
        user.email = email;
    }

    if (typeof b.password === 'string' && b.password.trim()) user.password = b.password;

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

        const newAmount = b.salaryAmount !== undefined ? asAmount(b.salaryAmount, 'salaryAmount') : undefined;
        const newCurrency = (b.salaryCurrency ?? b.sallaryCurrency) !== undefined
            ? asCurrency(b.salaryCurrency ?? b.sallaryCurrency, 'salaryCurrency')
            : undefined;

        const amountChanged = newAmount !== undefined && newAmount !== user.salary?.amount;
        const currencyChanged = newCurrency !== undefined && newCurrency !== user.salary?.currency;

        if (amountChanged || currencyChanged) {
            // Keep the old value so there is always a record of what the salary used to be.
            if (typeof user.salary?.amount === 'number') {
                user.salaryHistory.push({
                    amount: user.salary.amount,
                    currency: user.salary.currency,
                    effectiveFrom: user.salary.effectiveFrom,
                    changedBy: new Types.ObjectId(auth.id),
                    changedAt: new Date(),
                });
            }
            user.set('salary.amount', newAmount ?? user.salary?.amount);
            user.set('salary.currency', newCurrency ?? user.salary?.currency);
            user.set('salary.effectiveFrom', new Date());
        }
    } else if (b.status !== undefined || b.companyId !== undefined || b.salaryAmount !== undefined || b.salaryCurrency !== undefined) {
        throw forbidden('Only an admin can change status, company or salary');
    }

    await user.save();

    const { password: _password, ...safe } = user.toObject();
    res.status(200).json({
        success: true,
        message: "Employee profile updated",
        data: safe,
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
        const { id } = req.user;
        const Users = await User.find({
            _id: { $ne: id }
        }).select("-password").sort({ createdAt: -1 });

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
