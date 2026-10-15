const process = require('node:process');

const DEFAULT_CLIENT_VERSION = '1.15.0.2_20261001';

function parseClientVersion(value) {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+){2,4})_(\d{8})$/);
    return match ? { parts: match[1].split('.').map(Number), date: Number(match[2]) } : null;
}

function resolveClientVersion(value) {
    const version = String(value || '').trim();
    const candidate = parseClientVersion(version);
    const baseline = parseClientVersion(DEFAULT_CLIENT_VERSION);
    if (!candidate || !baseline) return version || DEFAULT_CLIENT_VERSION;
    if (candidate.date !== baseline.date) {
        return candidate.date < baseline.date ? DEFAULT_CLIENT_VERSION : version;
    }
    const width = Math.max(candidate.parts.length, baseline.parts.length);
    for (let index = 0; index < width; index += 1) {
        const delta = (candidate.parts[index] || 0) - (baseline.parts[index] || 0);
        if (delta !== 0) return delta < 0 ? DEFAULT_CLIENT_VERSION : version;
    }
    return version;
}

// 默认系统配置
const DEFAULT_SYSTEM_CONFIG = {
    serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
    clientVersion: DEFAULT_CLIENT_VERSION,
    platform: 'qq',
    os: 'iOS'
};

// 运行时配置（可被系统配置覆盖）
const CONFIG = {
    serverUrl: DEFAULT_SYSTEM_CONFIG.serverUrl,
    clientVersion: DEFAULT_SYSTEM_CONFIG.clientVersion,
    platform: DEFAULT_SYSTEM_CONFIG.platform,
    os: DEFAULT_SYSTEM_CONFIG.os,
    tsdkAceEnabled: process.env.FARM_TSDK_ACE_ENABLED !== 'false',
    // 官方 AceManager: SdkInitEx(3167, 0)
    tsdkGameId: Number(process.env.FARM_TSDK_GAME_ID || 3167),
    tsdkAppKey: String(process.env.FARM_TSDK_APP_KEY || '0'),
    heartbeatInterval: 25000,         // 心跳间隔 25秒
    farmCheckInterval: 3000,           // 农场检查间隔 3秒
    friendCheckInterval: 12000,        // 好友检查间隔 12秒
    farmCheckIntervalMin: 3000,        // 农场检查最小间隔 3秒
    farmCheckIntervalMax: 5000,        // 农场检查最大间隔 5秒
    friendCheckIntervalMin: 12000,     // 好友检查最小间隔 12秒
    friendCheckIntervalMax: 15000,     // 好友检查最大间隔 15秒
    adminPort: Number(process.env.ADMIN_PORT),
    adminPassword: process.env.ADMIN_PASSWORD
};

/**
 * 更新运行时配置
 * @param {object} config - 包含 serverUrl, clientVersion, platform, os 的配置对象
 */
function updateRuntimeConfig(config) {
    if (config.serverUrl && typeof config.serverUrl === 'string') {
        CONFIG.serverUrl = config.serverUrl;
    }
    if (config.clientVersion && typeof config.clientVersion === 'string') {
        CONFIG.clientVersion = resolveClientVersion(config.clientVersion);
    }
    if (config.platform && typeof config.platform === 'string') {
        CONFIG.platform = config.platform;
    }
    if (config.os && typeof config.os === 'string') {
        CONFIG.os = config.os;
    }
}

/**
 * 获取当前运行时配置快照
 */
function getRuntimeConfig() {
    return {
        serverUrl: CONFIG.serverUrl,
        clientVersion: CONFIG.clientVersion,
        platform: CONFIG.platform,
        os: CONFIG.os
    };
}

/**
 * 获取默认系统配置的副本
 */
function getDefaultSystemConfig() {
    return { ...DEFAULT_SYSTEM_CONFIG };
}

// 植物生长阶段枚举
const PlantPhase = {
    UNKNOWN: 0,        // 未知
    SEED: 1,           // 种子
    GERMINATION: 2,    // 发芽
    SMALL_LEAVES: 3,   // 小叶
    LARGE_LEAVES: 4,   // 大叶
    BLOOMING: 5,       // 开花
    MATURE: 6,         // 成熟
    DEAD: 7            // 枯死
};

// 植物阶段名称
const PHASE_NAMES = ['未知', '种子', '发芽', '小叶', '大叶', '开花', '成熟', '枯死'];

module.exports = {
    CONFIG,
    DEFAULT_CLIENT_VERSION,
    PlantPhase,
    PHASE_NAMES,
    updateRuntimeConfig,
    getRuntimeConfig,
    getDefaultSystemConfig,
    resolveClientVersion,
};
