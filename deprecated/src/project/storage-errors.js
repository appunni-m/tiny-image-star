export function storageTransactionError(error, fallback) {
  if (error?.name === "UnknownError" && /preparing Blob\/File data/i.test(error.message)) {
    return Object.assign(new Error("This browser cannot store image files in this window. Try a regular browser window with site storage enabled, then retry. Existing saved data is preserved."), { name: "StorageUnavailableError", cause: error });
  }
  return error ?? new Error(fallback);
}
