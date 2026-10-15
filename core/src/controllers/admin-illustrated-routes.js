const {
  buildIllustratedItem,
  getSeedShopGoodsMap,
  getUserLevel,
  sortIllustratedItems,
  summarizeIllustratedItems,
} = require("./admin-illustrated-helpers");
const {
  registerAdminIllustratedPurchaseRoutes,
} = require("./admin-illustrated-purchase-routes");
const { getNongmePlantData } = require("../services/nongme-plant-data");

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

function registerAdminIllustratedRoutes({
  app,
  provider,
  adminLogger,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const routeContext = {
    provider,
    adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  };

  registerAdminIllustratedPurchaseRoutes({
    app,
    ...routeContext,
  });

  app.get("/api/illustrated", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      const refresh = req.query.refresh === "true";
      const illustratedType = Number(req.query.illustrated_type) || 1;
      const userLevel = getUserLevel(provider, accountId);

      const [seedGoodsMap, illustratedList, nongmeData] = await Promise.all([
        getSeedShopGoodsMap({
          provider,
          accountId,
          adminLogger,
          tolerateFailure: true,
        }),
        provider.getIllustratedList(accountId, refresh, illustratedType),
        getNongmePlantData(refresh),
      ]);

      const items = sortIllustratedItems(
        (illustratedList?.items || []).map(item =>
          buildIllustratedItem(item, {
            seedGoodsMap,
            userLevel,
            nongmeFruitMap: nongmeData.byFruitId,
          }),
        ),
      );
      const summary = summarizeIllustratedItems(items);

      res.json({
        ok: true,
        data: {
          items,
          summary,
          userLevel,
          level: Number(illustratedList?.level) || 0,
          currentScore: Number(illustratedList?.current_score) || 0,
          nextScore: Number(illustratedList?.next_score) || 0,
        },
      });
    } catch (err) {
      adminLogger.error("获取图鉴列表失败", {
        error: err.message,
      });
      sendProviderError(res, err);
    }
  });
}

module.exports = { registerAdminIllustratedRoutes };
