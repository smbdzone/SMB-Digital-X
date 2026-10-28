import express from "express";
import { deleteUserController, getAllUserController, getUserController, loginController, registerController, updateController } from "../controller/user.controller.js";
import { isAllow, isVerified } from "../middlewares/isVerified.js";
import { forgotPasswordController, resetPasswordController, verifyResetCodeController } from "../controller/passwordReset.controller.js";
import { rateLimit } from "../middlewares/rateLimit.js";

const route = express.Router()

// Creating an employee sets their salary and company, so it is admin-only.
// (It used to be public: anyone could register themselves with any salary.)
// To create your very first admin, insert it directly in MongoDB or use a one-off seed script.
route.post('/register', isVerified, isAllow(['admin']), registerController)
route.post('/login', loginController)

// Forgot password (public). Limits are counted per email address.
const FIFTEEN_MIN = 15 * 60 * 1000
route.post('/forgot-password', rateLimit({ windowMs: FIFTEEN_MIN, max: 5, message: 'Too many reset requests. Please try again in a few minutes.' }), forgotPasswordController)
route.post('/verify-reset-code', rateLimit({ windowMs: FIFTEEN_MIN, max: 15, message: 'Too many attempts. Please try again in a few minutes.' }), verifyResetCodeController)
route.post('/reset-password', rateLimit({ windowMs: FIFTEEN_MIN, max: 15, message: 'Too many attempts. Please try again in a few minutes.' }), resetPasswordController)

route.patch('/update/:id', isVerified, isAllow(['admin', 'employee']), updateController)
route.get('/user', isVerified, isAllow(['admin', 'employee']), getUserController)
route.get('/all-user', isVerified, isAllow(['admin', 'employee']), getAllUserController)
route.delete('/delete-user/:id', isVerified, isAllow(['admin']), deleteUserController)


export default route
