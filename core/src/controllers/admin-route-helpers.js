function toBooleanFlag(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function createAdminRouteHelpers({ store, userStore, logger, getProvider }) {
  function requireDangerConfirmation(req, res, requiredConfirmation) {
    const confirmed = req && req.body ? toBooleanFlag(req.body.confirmed) : false;
    if (!confirmed) {
      return (
        res.status(400).json({
          ok: false,
          error: '危险操作未确认',
          requiredConfirmation,
        }),
        false
      );
    }
    return true;
  }

  function getAdminUserMutationError(currentUser, targetUsername) {
    const normalizedTarget = String(targetUsername || '').trim();
    if (!currentUser || !normalizedTarget) return null;
    if (currentUser.role === 'super_admin') return null;
    if (String(currentUser.username || '').trim() === normalizedTarget) return null;
    try {
      const users = userStore.getAllUsers();
      const targetUser = Array.isArray(users)
        ? users.find(
            user => String(user.username || '').trim() === normalizedTarget,
          )
        : null;
      if (targetUser && targetUser.role === 'admin')
        return '普通管理员不能修改或删除其他管理员账号';
    } catch {}
    return null;
  }

  function checkAccountLimit(mode) {
    const antiResaleConfig = store.getAntiResaleConfig();
    if (!antiResaleConfig.accountLimitEnabled) {
      return {
        ok: true,
        enabled: false,
        triggered: false,
        message: '账号数量限制功能未启用',
      };
    }
    const provider = typeof getProvider === 'function' ? getProvider() : null;
    if (!provider || typeof provider.getRunningAccountCount !== 'function') {
      return {
        ok: false,
        enabled: true,
        error: '无法获取运行账号数量',
      };
    }
    const runningCount = provider.getRunningAccountCount();
    const threshold = antiResaleConfig.accountLimitThreshold || 25;
    const triggered = runningCount > threshold;
    const result = {
      ok: true,
      enabled: true,
      triggered,
      runningCount,
      threshold,
      mode: mode || 'dry-run',
    };
    result.message = triggered
      ? `检测到运行账号数量(${  runningCount  })超过阈值(${  threshold  })`
      : `当前运行账号数量(${  runningCount  })未超过阈值(${  threshold  })`;
    return result;
  }

  function checkAccountLimitInterval() {
    try {
      const limitResult = checkAccountLimit('interval');
      if (!limitResult.ok || !limitResult.enabled || !limitResult.triggered)
        return;
      logger.warn('账号数量超限，已拦截自动清空账号动作', {
        runningCount: limitResult.runningCount,
        threshold: limitResult.threshold,
        mode: 'observe_only',
      });
    } catch (err) {
      logger.error('检查账号数量限制失败', {
        error: err.message,
      });
    }
  }

  function isExpectedProviderError(err) {
    const message = String((err && err.message) || '');
    return message === '账号未运行' || message === 'API Timeout';
  }

  function sendProviderError(res, err) {
    if (res.headersSent || res.writableEnded || res.destroyed || res.locals?.requestTimedOut)
      return;

    if (isExpectedProviderError(err)) {
      return res.json({
        ok: false,
        error: err.message,
      });
    }
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }

  function requireAdminRole(req, res, next) {
    if (
      !req.currentUser
      || (req.currentUser.role !== 'admin'
        && req.currentUser.role !== 'super_admin')
    ) {
      return res.status(403).json({
        ok: false,
        error: '需要管理员权限',
      });
    }
    next();
  }

  function requireSuperAdminRole(req, res, next) {
    if (!req.currentUser || req.currentUser.role !== 'super_admin') {
      return res.status(403).json({
        ok: false,
        error: '需要超级管理员权限',
      });
    }
    next();
  }

  return {
    checkAccountLimit,
    checkAccountLimitInterval,
    getAdminUserMutationError,
    requireAdminRole,
    adminRequired: requireAdminRole,
    checkUserAccess: requireAdminRole,
    requireDangerConfirmation,
    requireSuperAdminRole,
    sendProviderError,
  };
}

module.exports = {
  createAdminRouteHelpers,
};
