import express from "express";
import { changePasswordController, getAllUserController, getMyBankDetails, getUserController, loginController, requestBankDetailsChange, updateController } from "../controller/user.controller.js";
import { ownerConsoleOnly } from "../middlewares/ownerConsoleOnly.js";
import { isAllow, isVerified } from "../middlewares/isVerified.js";
import { forgotPasswordController, resetPasswordController, verifyResetCodeController } from "../controller/passwordReset.controller.js";
import { failedAttemptLimit, rateLimit } from "../middlewares/rateLimit.js";

const route = express.Router()

// New people are added in the Owner Console (signed and recorded). Refused here for everyone.
route.post('/register', ownerConsoleOnly)

// Forgot password (public). Limits are counted per email address.
const FIFTEEN_MIN = 15 * 60 * 1000
// Login: 5 FAILED attempts per email + IP per 15 minutes; a successful login clears the count.
route.post('/login', failedAttemptLimit({ windowMs: FIFTEEN_MIN, max: 5, message: 'Too many login attempts. Please try again in a few minutes.' }), loginController)
route.post('/forgot-password', rateLimit({ windowMs: FIFTEEN_MIN, max: 5, message: 'Too many reset requests. Please try again in a few minutes.' }), forgotPasswordController)
route.post('/verify-reset-code', rateLimit({ windowMs: FIFTEEN_MIN, max: 15, message: 'Too many attempts. Please try again in a few minutes.' }), verifyResetCodeController)
route.post('/reset-password', rateLimit({ windowMs: FIFTEEN_MIN, max: 15, message: 'Too many attempts. Please try again in a few minutes.' }), resetPasswordController)

// Signed in, own account: needs the current password. Limited per IP like the reset endpoints.
route.post('/change-password', isVerified, rateLimit({ windowMs: FIFTEEN_MIN, max: 10, message: 'Too many attempts. Please try again in a few minutes.' }), changePasswordController)
// Employees ask for new bank details; the owner approves them in the Owner Console.
route.get('/bank-details', isVerified, getMyBankDetails)
route.post('/bank-details/request', isVerified, rateLimit({ windowMs: FIFTEEN_MIN, max: 5, message: 'Too many requests. Please try again later.' }), requestBankDetailsChange)
route.patch('/update/:id', isVerified, isAllow(['admin', 'employee']), updateController)
route.get('/user', isVerified, isAllow(['admin', 'employee']), getUserController)
route.get('/all-user', isVerified, isAllow(['admin', 'employee']), getAllUserController)
// No delete: people are deactivated in the Owner Console, so their salary and letter history stays.


export default route
