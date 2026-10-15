const {
  collectBuyableIllustratedItems,
  getSeedShopGoodsMap,
  getUserLevel,
} = require("./admin-illustrated-helpers");
const { getNongmePlantData } = require("../services/nongme-plant-data");

const BUY_ALL_DELAY_MS = 200;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getAuthorizedAccountId(req, res, { getAccountIdFromRequest, canAccessAccount }) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    res.status(400).json({
      ok: false,
      error: "Missing x-account-id",
    });
    return null;
  }

  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({
      ok: false,
      error: "无权访问此账号",
    });
    return null;
  }

  return accountId;
}

function registerAdminIllustratedPurchaseRoutes({
  app,
  provider,
  adminLogger,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const routeContext = {
    getAccountIdFromRequest,
    canAccessAccount,
  };

  app.post("/api/illustrated/buy", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      const { goodsId, price } = req.body || {};
      if (!goodsId) {
        return res.status(400).json({
          ok: false,
          error: "缺少商品ID",
        });
      }

      const result = await provider.buyGoods(accountId, goodsId, 1, price || 0);
      adminLogger.info("图鉴购买种子成功", {
        accountId,
        goodsId,
        price,
      });

      res.json({
        ok: true,
        data: result,
      });
    } catch (err) {
      adminLogger.error("图鉴购买种子失败", {
        error: err.message,
      });
      sendProviderError(res, err);
    }
  });

  app.post("/api/illustrated/buy-all", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      const userLevel = getUserLevel(provider, accountId);
      const illustratedType = Number(req.body?.illustrated_type) || 1;
      const [seedGoodsMap, illustratedList, nongmeData] = await Promise.all([
        getSeedShopGoodsMap({
          provider,
          accountId,
          adminLogger,
        }),
        provider.getIllustratedList(accountId, false, illustratedType),
        getNongmePlantData(),
      ]);
      const buyableItems = collectBuyableIllustratedItems(
        illustratedList?.items || [],
        {
          seedGoodsMap,
          userLevel,
          nongmeFruitMap: nongmeData.byFruitId,
        },
      );

      adminLogger.info("图鉴一键购买开始", {
        accountId,
        count: buyableItems.length,
      });

      const results = [];
      let successCount = 0;
      let failCount = 0;

      for (const item of buyableItems) {
        try {
          await provider.buyGoods(accountId, item.goodsId, 1, item.price);
          results.push({
            ...item,
            success: true,
          });
          successCount++;
          await delay(BUY_ALL_DELAY_MS);
        } catch (err) {
          results.push({
            ...item,
            success: false,
            error: err.message,
          });
          failCount++;
        }
      }

      adminLogger.info("图鉴一键购买完成", {
        accountId,
        successCount,
        failCount,
      });

      res.json({
        ok: true,
        data: {
          total: buyableItems.length,
          successCount,
          failCount,
          results,
        },
      });
    } catch (err) {
      adminLogger.error("图鉴一键购买失败", {
        error: err.message,
      });
      sendProviderError(res, err);
    }
  });
}

module.exports = { registerAdminIllustratedPurchaseRoutes };
