import jwt from "jsonwebtoken";
import User from "../model/user.model.js";
const AUTH_COOKIE_NAME = "smb-token";
export const isVerified = async (req, res, next) => {
    try {
        let token = req.cookies?.[AUTH_COOKIE_NAME];
        // If token is not in cookie, check Authorization header
        if (!token) {
            const authHeader = req.header("Authorization");
            if (authHeader?.startsWith("Bearer ")) {
                token = authHeader.split(" ")[1];
            }
        }
        if (!token) {
            res.status(401).json({
                success: false,
                message: "No authentication token, access denied",
            });
            return;
        }
        const verify = jwt.verify(token, process.env.JWT_SECRET);
        // After a password reset, every token issued before it stops working.
        // (Also rejects tokens of accounts that were deleted.)
        const account = await User.findById(verify.id).select("passwordChangedAt").lean();
        if (!account) {
            res.status(401).json({
                success: false,
                message: "Account no longer exists",
            });
            return;
        }
        if (account.passwordChangedAt && verify.iat !== undefined
            && verify.iat < Math.floor(account.passwordChangedAt.getTime() / 1000)) {
            res.status(401).json({
                success: false,
                message: "Password was changed. Please log in again.",
            });
            return;
        }
        // Attach authenticated user to request
        req.user = {
            id: verify.id,
            role: verify.role,
        };
        next();
    }
    catch (error) {
        console.error("Error in isVerified middleware:", error);
        res.status(401).json({
            success: false,
            message: "Invalid or expired authentication token",
        });
    }
};
export const isAllow = (roles) => {
    return (req, res, next) => {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    message: "Unauthorized",
                });
                return;
            }
            if (!req.user.role) {
                res.status(403).json({
                    success: false,
                    message: "User role not found",
                });
                return;
            }
            if (!roles.includes(req.user.role)) {
                res.status(403).json({
                    success: false,
                    message: "You do not have permission to access this resource",
                });
                return;
            }
            next();
        }
        catch (error) {
            console.error("Error in isAllow middleware:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    };
};
