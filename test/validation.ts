import mongoose from 'mongoose';

/** Runs Mongoose validation and returns the per-path errors, or undefined when valid. */
export async function validationErrors(doc: {
  validate(): Promise<void>;
}): Promise<Record<string, unknown> | undefined> {
  try {
    await doc.validate();
    return undefined;
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) return error.errors;
    throw error;
  }
}
