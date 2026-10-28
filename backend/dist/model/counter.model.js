import mongoose, { Schema } from 'mongoose';
const counterSchema = new Schema({
    _id: { type: String },
    seq: { type: Number, default: 0 },
});
const Counter = mongoose.model('Counter', counterSchema);
/** Atomic "next number" for a key. Safe when several requests arrive at the same time. */
export const nextSequence = async (key) => {
    const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    return doc.seq;
};
export default Counter;
