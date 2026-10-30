import pushSubscriptionModel from '../model/pushSubscription.model.js';
import { badRequest, getAuth } from '../utils/http.js';
// POST /api/push/subscribe   body = the browser's PushSubscription JSON { endpoint, keys: { p256dh, auth } }
export const subscribePush = async (req, res) => {
    const auth = getAuth(req);
    const { endpoint, keys } = req.body ?? {};
    if (typeof endpoint !== 'string' || !endpoint || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
        throw badRequest('Invalid push subscription');
    }
    // The same device can be used by different people one after another: the latest login owns it.
    await pushSubscriptionModel.findOneAndUpdate({ endpoint }, {
        userId: auth.id,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: req.headers['user-agent'],
    }, { upsert: true, new: true });
    res.status(201).json({ success: true, message: 'Push notifications enabled' });
};
// POST /api/push/unsubscribe   body = { endpoint }
export const unsubscribePush = async (req, res) => {
    const auth = getAuth(req);
    const { endpoint } = req.body ?? {};
    if (typeof endpoint !== 'string' || !endpoint)
        throw badRequest('endpoint is required');
    await pushSubscriptionModel.deleteOne({ endpoint, userId: auth.id });
    res.json({ success: true, message: 'Push notifications disabled' });
};
