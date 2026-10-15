const {
  normalizeAccountRef,
  resolveAccountId,
} = require('../services/account-resolver');

function createAdminAccountAccess({ store, getProvider }) {
  function getAccountsForUser(username = null) {
    try {
      const provider = typeof getProvider === 'function' ? getProvider() : null;
      if (provider && typeof provider.getAccounts === 'function') {
        const providerAccounts = provider.getAccounts();
        if (providerAccounts && Array.isArray(providerAccounts.accounts)) {
          if (username) {
            return providerAccounts.accounts.filter(
              account => account.username === username,
            );
          }
          return providerAccounts.accounts;
        }
      }
    } catch {}

    const emptyAccounts = {};
    emptyAccounts.accounts = [];
    const storedAccounts = store.getAccounts
      ? store.getAccounts()
      : emptyAccounts;
    let accounts = Array.isArray(storedAccounts.accounts)
      ? storedAccounts.accounts
      : [];
    if (username) {
      accounts = accounts.filter(account => account.username === username);
    }
    return accounts;
  }

  function canAccessAccount(req, accountId) {
    const currentUser = req.currentUser;
    if (!currentUser) return false;
    // 超级管理员拥有全站最高访问权限，可无缝查看与配置所有用户账号
    if (currentUser.role === 'admin' || currentUser.username === 'admin') {
      return true;
    }
    const accountList = getAccountsForUser();
    const account = accountList.find(item => item.id === accountId);
    if (!account) return false;
    return account.username === currentUser.username;
  }

  function getAccessibleAccountIdsFromRequest(req) {
    const currentUser = req.currentUser;
    if (!currentUser) return [];
    const accountList = getAccountsForUser(currentUser.username);
    return accountList.map(account => account.id);
  }

  function getAccessibleAccountIdsForUser(user) {
    if (!user) return [];
    const accountList = getAccountsForUser(user.username);
    return accountList.map(account => account.id);
  }

  function resolveAccountReference(ref) {
    const normalizedRef = normalizeAccountRef(ref);
    if (!normalizedRef) return '';
    const provider = typeof getProvider === 'function' ? getProvider() : null;
    if (provider && typeof provider.resolveAccountId === 'function') {
      const providerAccountId = normalizeAccountRef(
        provider.resolveAccountId(normalizedRef),
      );
      if (providerAccountId) return providerAccountId;
    }
    const accountId = resolveAccountId(getAccountsForUser(), normalizedRef);
    return accountId || normalizedRef;
  }

  function getAccountIdFromRequest(req) {
    return resolveAccountReference(req.headers['x-account-id']);
  }

  return {
    canAccessAccount,
    getAccessibleAccountIdsForUser,
    getAccessibleAccountIdsFromRequest,
    getAccountIdFromRequest,
    getAccountsForUser,
    resolveAccountReference,
  };
}

module.exports = {
  createAdminAccountAccess,
};
