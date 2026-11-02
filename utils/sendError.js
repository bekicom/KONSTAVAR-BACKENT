/**
 * Controller catch bloklari uchun yakuniy javob.
 *
 * Xatoda `statusCode` bo'lsa (masalan `ensureWarehouseAccess` -> 403 yoki
 * `stockOps` -> 409) shu kod qaytariladi, aks holda 500.
 */
const sendError = (res, error) => {
  if (error && error.statusCode) {
    return res.status(error.statusCode).json({
      message: error.message,
      code: error.code,
    });
  }

  return res.status(500).json({ message: error && error.message });
};

module.exports = { sendError };
