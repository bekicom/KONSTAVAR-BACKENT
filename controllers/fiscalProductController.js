const productController = require("./productController");

module.exports = {
  getFiscalProducts: productController.getFiscalProducts,
  getFiscalProductById: productController.getFiscalProductById,
  saveFiscalProduct: productController.saveFiscalProduct,
  deleteFiscalProduct: productController.deleteFiscalProduct,
};
