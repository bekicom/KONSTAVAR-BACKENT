const mongoose = require("mongoose");
const Purchase = require("../models/Purchase");
const Product = require("../models/Product");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");
const Supplier = require("../models/Supplier");
const Category = require("../models/Category");

const toNumberOrNaN = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : Number.NaN;
};

const toBoolean = (value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return Boolean(value);
};

exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { warehouseId, items, supplierId, supplier, paymentType, paidAmount } = req.body;

    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    const warehouse = await Warehouse.findById(warehouseId).lean();
    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items required" });
    }

    const normalizedPaymentType = paymentType || "cash";
    if (!["cash", "credit"].includes(normalizedPaymentType)) {
      return res.status(400).json({ message: "Invalid paymentType. Use 'cash' or 'credit'" });
    }

    let purchaseDoc;

    await session.withTransaction(async () => {
      let totalAmount = 0;
      const processedItems = [];
      let resolvedSupplier;

      if (supplierId) {
        if (!mongoose.Types.ObjectId.isValid(supplierId)) {
          throw new Error("Invalid supplierId");
        }
        resolvedSupplier = await Supplier.findById(supplierId).session(session);
      }

      if (!resolvedSupplier && supplier?.name) {
        if (supplier.phone) {
          resolvedSupplier = await Supplier.findOne({ phone: supplier.phone }).session(session);
        }

        if (!resolvedSupplier) {
          const createdSuppliers = await Supplier.create(
            [
              {
                name: supplier.name,
                phone: supplier.phone,
                address: supplier.address,
                note: supplier.note,
              },
            ],
            { session },
          );
          [resolvedSupplier] = createdSuppliers;
        }
      }

      if (!resolvedSupplier) {
        throw new Error("supplierId or supplier{name,...} is required");
      }

      for (const item of items) {
        let {
          productId,
          name,
          model,
          categoryId,
          categoryName,
          category,
          barcode,
          hasPackage,
          packageQuantity,
          purchasePrice,
          blockPurchasePrice,
          sellPrice,
          sellPriceStrategy,
          wholesalePrice,
          blockSellPrice,
          inputType,
        } = item;
        const inputQuantity = toNumberOrNaN(item?.inputQuantity);
        const normalizedPackageQuantity = toNumberOrNaN(packageQuantity);
        const normalizedPurchasePrice = toNumberOrNaN(purchasePrice);
        const normalizedBlockPurchasePrice = toNumberOrNaN(blockPurchasePrice);
        const normalizedSellPrice = toNumberOrNaN(sellPrice);
        const normalizedWholesalePrice = toNumberOrNaN(wholesalePrice);
        const normalizedBlockSellPrice = toNumberOrNaN(blockSellPrice);

        let resolvedCategoryId = null;
        if (categoryId) {
          if (!mongoose.Types.ObjectId.isValid(categoryId)) {
            throw new Error("Invalid categoryId");
          }
          const categoryExists = await Category.findById(categoryId).session(session);
          if (!categoryExists) {
            throw new Error("Category not found");
          }
          resolvedCategoryId = categoryExists._id;
        } else {
          const incomingCategoryName = (category?.name || categoryName || "").trim();
          if (incomingCategoryName) {
            let foundCategory = await Category.findOne({ name: incomingCategoryName }).session(
              session,
            );

            if (!foundCategory) {
              const createdCategories = await Category.create(
                [
                  {
                    name: incomingCategoryName,
                    description: category?.description || "",
                  },
                ],
                { session },
              );
              [foundCategory] = createdCategories;
            }

            resolvedCategoryId = foundCategory._id;
          }
        }

        if (!["unit", "block"].includes(inputType)) {
          throw new Error("Invalid inputType. Use 'unit' or 'block'");
        }

        if (!Number.isFinite(inputQuantity) || inputQuantity <= 0) {
          throw new Error("inputQuantity must be a positive number");
        }

        let product;

        if (productId) {
          if (!mongoose.Types.ObjectId.isValid(productId)) {
            throw new Error("Invalid productId");
          }
          product = await Product.findById(productId).session(session);
        }

        if (!product && barcode) {
          product = await Product.findOne({ barcode }).session(session);
        }

        if (!product) {
          if (!name || !sellPrice) {
            throw new Error("New product requires at least name and sellPrice");
          }

          hasPackage = toBoolean(hasPackage);
          if (hasPackage && (!Number.isFinite(normalizedPackageQuantity) || normalizedPackageQuantity <= 0)) {
            throw new Error("packageQuantity must be positive when hasPackage=true");
          }

          if (hasPackage && normalizedBlockPurchasePrice > 0) {
            purchasePrice = normalizedBlockPurchasePrice / normalizedPackageQuantity;
          } else {
            purchasePrice = normalizedPurchasePrice;
          }

          if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
            throw new Error("purchasePrice must be a positive number");
          }

          const createdProducts = await Product.create(
            [
              {
                name,
                model,
                categoryId: resolvedCategoryId,
                barcode,
                hasPackage,
                packageQuantity: hasPackage ? normalizedPackageQuantity : null,
                purchasePrice,
                blockPurchasePrice: hasPackage && normalizedBlockPurchasePrice > 0 ? normalizedBlockPurchasePrice : null,
                sellPrice: normalizedSellPrice,
                wholesalePrice: Number.isFinite(normalizedWholesalePrice) && normalizedWholesalePrice > 0 ? normalizedWholesalePrice : null,
                blockSellPrice: Number.isFinite(normalizedBlockSellPrice) && normalizedBlockSellPrice > 0 ? normalizedBlockSellPrice : null,
              },
            ],
            { session },
          );
          [product] = createdProducts;
        }

        if (resolvedCategoryId) {
          product.categoryId = resolvedCategoryId;
        }

        let quantity = 0;

        if (inputType === "block") {
          if (!product.hasPackage || !product.packageQuantity) {
            throw new Error("This product does not support block purchase");
          }
          quantity = inputQuantity * product.packageQuantity;
        }

        if (inputType === "unit") {
          quantity = inputQuantity;
        }

        const currentStock = await Stock.findOne({
          productId: product._id,
          warehouseId,
        }).session(session);
        const previousQuantity = currentStock ? currentStock.quantity : 0;

        const strategy = sellPriceStrategy || "old";
        if (!["old", "new", "average"].includes(strategy)) {
          throw new Error("Invalid sellPriceStrategy. Use 'old', 'new' or 'average'");
        }

        if (!product.isNew) {
          if (strategy !== "old") {
            if (!Number.isFinite(normalizedSellPrice) || normalizedSellPrice <= 0) {
              throw new Error("sellPrice must be a positive number when strategy is new/average");
            }
          }

          if (strategy === "new") {
            product.sellPrice = normalizedSellPrice;
          }

          if (strategy === "average") {
            if (previousQuantity <= 0) {
              product.sellPrice = normalizedSellPrice;
            } else {
              const weightedSellPrice =
                (product.sellPrice * previousQuantity + normalizedSellPrice * quantity) /
                (previousQuantity + quantity);
              product.sellPrice = Number(weightedSellPrice.toFixed(2));
            }
          }
        }

        if (Number.isFinite(normalizedWholesalePrice) && normalizedWholesalePrice > 0) {
          product.wholesalePrice = normalizedWholesalePrice;
        }
        if (Number.isFinite(normalizedBlockSellPrice) && normalizedBlockSellPrice > 0) {
          product.blockSellPrice = normalizedBlockSellPrice;
        }

        let unitPurchasePrice = Number(purchasePrice);
        if (!Number.isFinite(unitPurchasePrice) || unitPurchasePrice <= 0) {
          const blockPrice = normalizedBlockPurchasePrice;
          if (
            Number.isFinite(blockPrice) &&
            blockPrice > 0 &&
            product.hasPackage &&
            product.packageQuantity > 0
          ) {
            unitPurchasePrice = blockPrice / product.packageQuantity;
          } else {
            unitPurchasePrice = product.purchasePrice;
          }
        }

        if (!Number.isFinite(unitPurchasePrice) || unitPurchasePrice <= 0) {
          throw new Error("Valid purchase price is required");
        }

        product.purchasePrice = Number(unitPurchasePrice.toFixed(2));
        if (
          Number.isFinite(normalizedBlockPurchasePrice) &&
          normalizedBlockPurchasePrice > 0 &&
          product.hasPackage
        ) {
          product.blockPurchasePrice = normalizedBlockPurchasePrice;
        }
        await product.save({ session });

        const total = quantity * unitPurchasePrice;
        totalAmount += total;

        await Stock.findOneAndUpdate(
          {
            productId: product._id,
            warehouseId,
          },
          {
            $inc: { quantity },
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
            session,
          },
        );

        processedItems.push({
          productId: product._id,
          inputType,
          inputQuantity,
          packageQuantity: product.packageQuantity || null,
          quantity,
          unitPurchasePrice,
          total,
        });
      }

      let normalizedPaidAmount = Number(paidAmount);

      if (!Number.isFinite(normalizedPaidAmount)) {
        normalizedPaidAmount = normalizedPaymentType === "cash" ? totalAmount : 0;
      }

      if (normalizedPaidAmount < 0) {
        throw new Error("paidAmount cannot be negative");
      }

      if (normalizedPaidAmount > totalAmount) {
        throw new Error("paidAmount cannot be greater than totalAmount");
      }

      if (normalizedPaymentType === "cash") {
        normalizedPaidAmount = totalAmount;
      }

      const dueAmount = Number((totalAmount - normalizedPaidAmount).toFixed(2));

      const purchases = await Purchase.create(
        [
          {
            warehouseId,
            supplierId: resolvedSupplier._id,
            items: processedItems,
            totalAmount,
            paymentType: normalizedPaymentType,
            paidAmount: Number(normalizedPaidAmount.toFixed(2)),
            dueAmount,
            createdBy: req.user._id,
          },
        ],
        { session },
      );

      [purchaseDoc] = purchases;
    });

    res.status(201).json({
      message: "Purchase created successfully",
      purchase: purchaseDoc,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("must") ||
      error.message.includes("cannot")
    ) {
      return res.status(400).json({ message: error.message });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        message: "Duplicate key error. Product barcode or supplier phone must be unique",
      });
    }

    res.status(500).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};

exports.getPurchases = async (req, res) => {
  try {
    const { supplierId, warehouseId, paymentType } = req.query;
    const query = {};

    if (supplierId) {
      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return res.status(400).json({ message: "Invalid supplierId query" });
      }
      query.supplierId = supplierId;
    }

    if (warehouseId) {
      if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouseId query" });
      }
      query.warehouseId = warehouseId;
    }

    if (paymentType) {
      if (!["cash", "credit"].includes(paymentType)) {
        return res.status(400).json({ message: "Invalid paymentType query" });
      }
      query.paymentType = paymentType;
    }

    const purchases = await Purchase.find(query)
      .sort({ createdAt: -1 })
      .populate("supplierId", "name phone")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode");

    res.json(purchases);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid purchase ID" });
    }

    const purchase = await Purchase.findById(id)
      .populate("supplierId", "name phone address")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode");

    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    res.json(purchase);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updatePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const { supplierId, paymentType, paidAmount } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid purchase ID" });
    }

    const purchase = await Purchase.findById(id);
    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    if (supplierId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const supplierExists = await Supplier.exists({ _id: supplierId });
      if (!supplierExists) {
        return res.status(404).json({ message: "Supplier not found" });
      }
      purchase.supplierId = supplierId;
    }

    if (paymentType !== undefined) {
      if (!["cash", "credit"].includes(paymentType)) {
        return res.status(400).json({ message: "Invalid paymentType. Use 'cash' or 'credit'" });
      }
      purchase.paymentType = paymentType;
    }

    let normalizedPaidAmount =
      paidAmount !== undefined ? Number(paidAmount) : Number(purchase.paidAmount);
    if (!Number.isFinite(normalizedPaidAmount) || normalizedPaidAmount < 0) {
      return res.status(400).json({ message: "paidAmount must be a non-negative number" });
    }

    if (purchase.paymentType === "cash") {
      normalizedPaidAmount = purchase.totalAmount;
    }

    if (normalizedPaidAmount > purchase.totalAmount) {
      return res.status(400).json({ message: "paidAmount cannot be greater than totalAmount" });
    }

    purchase.paidAmount = Number(normalizedPaidAmount.toFixed(2));
    purchase.dueAmount = Number((purchase.totalAmount - purchase.paidAmount).toFixed(2));

    await purchase.save();

    const updated = await Purchase.findById(purchase._id)
      .populate("supplierId", "name phone")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode");

    res.json({
      message: "Purchase updated successfully",
      purchase: updated,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deletePurchase = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid purchase ID" });
    }

    await session.withTransaction(async () => {
      const purchase = await Purchase.findById(id).session(session);
      if (!purchase) {
        throw new Error("Purchase not found");
      }

      for (const item of purchase.items) {
        const stock = await Stock.findOne({
          productId: item.productId,
          warehouseId: purchase.warehouseId,
        }).session(session);

        if (!stock) {
          throw new Error("Stock not found for one of purchase items");
        }

        if (stock.quantity < item.quantity) {
          throw new Error("Cannot delete purchase. Some quantity already sold/moved");
        }
      }

      for (const item of purchase.items) {
        await Stock.findOneAndUpdate(
          {
            productId: item.productId,
            warehouseId: purchase.warehouseId,
          },
          {
            $inc: { quantity: -item.quantity },
          },
          { session },
        );
      }

      await Purchase.findByIdAndDelete(id).session(session);
    });

    res.json({ message: "Purchase deleted successfully" });
  } catch (error) {
    if (error.message === "Purchase not found") {
      return res.status(404).json({ message: error.message });
    }

    if (
      error.message.includes("Cannot delete purchase") ||
      error.message.includes("Stock not found")
    ) {
      return res.status(400).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};
