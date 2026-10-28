import mongoose, { Schema } from 'mongoose'

interface ICounter {
    _id: string
    seq: number
}

const counterSchema = new Schema<ICounter>({
    _id: { type: String },
    seq: { type: Number, default: 0 },
})

const Counter = mongoose.model<ICounter>('Counter', counterSchema)

/** Atomic "next number" for a key. Safe when several requests arrive at the same time. */
export const nextSequence = async (key: string): Promise<number> => {
    const doc = await Counter.findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    return doc!.seq
}

export default Counter
