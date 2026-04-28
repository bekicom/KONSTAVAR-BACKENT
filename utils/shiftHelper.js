const mongoose = require("mongoose");
const Shop = require("../models/Shop");
const Shift = require("../models/Shift");

const resolveCashierShop = async (user, session = null) => {
  if (!user || user.role !== "cashier") {
    return null;
  }

  if (!user.shopId) {
    throw new Error("Cashier has no assigned shop");
  }

  const shopId = user.shopId?._id || user.shopId;
  if (!mongoose.Types.ObjectId.isValid(shopId)) {
    throw new Error("Invalid user shopId");
  }

  let shopQuery = Shop.findOne({ _id: shopId, isActive: true });
  if (session) shopQuery = shopQuery.session(session);
  const shop = await shopQuery;

  if (!shop) {
    throw new Error("Assigned shop not found or inactive");
  }

  return shop;
};

const getOpenCashierShift = async (user, session = null) => {
  if (!user || user.role !== "cashier") {
    return null;
  }

  const shop = await resolveCashierShop(user, session);

  let shiftQuery = Shift.findOne({
    cashierId: user._id,
    shopId: shop._id,
    status: "open",
  }).sort({ openedAt: -1 });

  if (session) shiftQuery = shiftQuery.session(session);
  return shiftQuery;
};

const requireOpenCashierShift = async (user, session = null) => {
  const shift = await getOpenCashierShift(user, session);
  if (!shift) {
    throw new Error("Open shift required");
  }

  return shift;
};

module.exports = {
  resolveCashierShop,
  getOpenCashierShift,
  requireOpenCashierShift,
};
