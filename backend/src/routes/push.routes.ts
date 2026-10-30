import { Router } from 'express'
import { subscribePush, unsubscribePush } from '../controller/push.controller.js'
import { isVerified } from '../middlewares/isVerified.js'

const router = Router()

// Every route requires a logged-in user.
router.use(isVerified)

router.post('/subscribe', subscribePush)
router.post('/unsubscribe', unsubscribePush)

export default router
