import { Request, Response } from 'express';

export const OWNER_CONSOLE_ONLY = 'This action is done in the Owner Console';

/**
 * Owner actions are done only in the Owner Console (signed, recorded, see owner/). The website routes that used to
 * do them now refuse everyone, the admin included.
 */
export const ownerConsoleOnly = (_req: Request, res: Response): void => {
    res.status(403).json({ success: false, message: OWNER_CONSOLE_ONLY, ownerConsole: true });
};
