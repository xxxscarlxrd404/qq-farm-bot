#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { filterInvalidPlants } = require('../src/config/invalidPlants');

const APP_ID = '1112386029';
const ASTCENC_VERSION = '5.5.0';
const ASTCENC_URL = `https://github.com/ARM-software/astc-encoder/releases/download/${ASTCENC_VERSION}/astcenc-${ASTCENC_VERSION}-macos-universal.zip`;
const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const HEX = '0123456789abcdef';
const coreRoot = path.resolve(__dirname, '..');
const defaultOutput = path.join(coreRoot, 'src', 'gameConfig', 'plant_images');
const toolDir = path.join(coreRoot, 'data', 'tools', `astcenc-${ASTCENC_VERSION}`);

function parseArgs(argv) {
  const args = { assets: [], all: false, installTool: false, downloadMissing: false, output: defaultOutput };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--assets') args.assets.push(...String(argv[++index] || '').split(',').filter(Boolean));
    else if (value === '--all') args.all = true;
    else if (value === '--output') args.output = path.resolve(argv[++index]);
    else if (value === '--astcenc') args.astcenc = path.resolve(argv[++index]);
    else if (value === '--install-tool') args.installTool = true;
    else if (value === '--download-missing') args.downloadMissing = true;
    else if (value === '--help' || value === '-h') args.help = true;
    else throw new Error(`未知参数：${value}`);
  }
  return args;
}

function usage() {
  return [
    '从本机 QQ 农场缓存导出浏览器可用的植物阶段 PNG。',
    '',
    '用法：',
    '  npm run extract:plant-phases -- --install-tool --download-missing --assets Crop_1037,Crop_9003',
    '  npm run extract:plant-phases -- --all',
    '',
    '选项：',
    '  --assets <列表>   只导出指定 Crop 资源，逗号分隔',
    '  --all             导出 Plant.json 可推导且已缓存的全部资源',
    '  --install-tool    缺少 astcenc 时下载 ARM 官方 macOS 通用版',
    '  --download-missing 从QQ官方CDN下载本地尚未缓存的阶段纹理（不写入QQ缓存）',
    '  --astcenc <路径>  显式指定 astcenc',
    '  --output <目录>   修改输出目录',
  ].join('\n');
}

function getQqGameCacheRoots() {
  const root = path.join(
    os.homedir(),
    'Library/Containers/com.tencent.qqexminiprogram/Data/Library/Application Support/QQEX/miniapp/fs',
  );
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, entry.name, APP_ID, 'usr', 'gamecaches'))
    .filter(candidate => fs.existsSync(path.join(candidate, 'cacheList.json')));
}

function resolveQqFile(cacheRoot, value) {
  const prefix = 'qqfile://usr/gamecaches/';
  if (!value || !value.startsWith(prefix)) return null;
  return path.join(cacheRoot, value.slice(prefix.length));
}

function loadCacheEntries(cacheRoots) {
  const entries = [];
  for (const cacheRoot of cacheRoots) {
    const cacheList = JSON.parse(fs.readFileSync(path.join(cacheRoot, 'cacheList.json'), 'utf8'));
    for (const [url, metadata] of Object.entries(cacheList.files || {})) {
      const localPath = resolveQqFile(cacheRoot, metadata && metadata.url);
      if (localPath && fs.existsSync(localPath)) {
        entries.push({ url, localPath, lastTime: Number(metadata.lastTime) || 0 });
      }
    }
  }
  return entries;
}

function findLatestPlantConfig(entries) {
  return entries
    .filter(entry => /\/plant\/config\.[^.]+\.json$/i.test(entry.url))
    .sort((left, right) => right.lastTime - left.lastTime)[0] || null;
}

function findLatestMainsceneConfig(entries) {
  return entries
    .filter(entry => /\/mainscene\/config\.[^.]+\.json$/i.test(entry.url))
    .sort((left, right) => right.lastTime - left.lastTime)[0] || null;
}

function decodeUuid(value) {
  const compact = String(value || '').split('@')[0];
  if (compact.length !== 22) return compact;
  let result = compact.slice(0, 2);
  for (let index = 2; index < 22; index += 2) {
    const left = BASE64_KEYS.indexOf(compact[index]);
    const right = BASE64_KEYS.indexOf(compact[index + 1]);
    result += HEX[left >> 2];
    result += HEX[((left & 3) << 2) | (right >> 4)];
    result += HEX[right & 15];
  }
  return `${result.slice(0, 8)}-${result.slice(8, 12)}-${result.slice(12, 16)}-${result.slice(16, 20)}-${result.slice(20)}`;
}

function commandExists(command) {
  return spawnSync('sh', ['-c', `command -v "${command}"`], { encoding: 'utf8' }).status === 0;
}

function installAstcenc() {
  if (process.platform !== 'darwin') {
    throw new Error('--install-tool 当前仅支持 macOS；其他系统请通过 --astcenc 指定工具');
  }
  fs.mkdirSync(toolDir, { recursive: true });
  const archive = path.join(toolDir, 'astcenc.zip');
  const curl = spawnSync('curl', ['-L', '--fail', '--output', archive, ASTCENC_URL], { stdio: 'inherit' });
  if (curl.status !== 0) throw new Error('下载 ARM astcenc 失败');
  const unzip = spawnSync('unzip', ['-o', archive, '-d', toolDir], { stdio: 'inherit' });
  if (unzip.status !== 0) throw new Error('解压 ARM astcenc 失败');
  return path.join(toolDir, 'bin', 'astcenc');
}

function resolveAstcenc(args) {
  const candidates = [
    args.astcenc,
    process.env.ASTCENC_BIN,
    path.join(toolDir, 'bin', 'astcenc'),
    '/tmp/astcenc-5.5.0/bin/astcenc',
  ].filter(Boolean);
  const existing = candidates.find(candidate => fs.existsSync(candidate));
  if (existing) return existing;
  if (commandExists('astcenc')) return 'astcenc';
  if (args.installTool) return installAstcenc();
  throw new Error('未找到 astcenc。请增加 --install-tool，或通过 --astcenc/ASTCENC_BIN 指定');
}

function getAssets(args) {
  if (args.assets.length) return [...new Set(args.assets)];
  if (args.all) {
    const plants = filterInvalidPlants(JSON.parse(fs.readFileSync(path.join(coreRoot, 'src', 'gameConfig', 'Plant.json'), 'utf8')));
    const assets = plants
      .map(plant => Number(plant.seed_id) - 20000)
      .filter(id => id > 0)
      .map(id => `Crop_${id}`);
    assets.push(...plants
      .filter(plant => Number(plant.size) === 2 && !(Number(plant.seed_id) > 20000))
      .map(plant => `Plant_${plant.id}`));
    return [...new Set(assets)];
  }
  const events = JSON.parse(fs.readFileSync(path.join(coreRoot, 'src', 'gameConfig', 'EventPlants.json'), 'utf8'));
  return [...new Set(events.map(plant => plant.asset_name).filter(Boolean))];
}

function getPhaseResources(config, assets) {
  const wanted = new Set(assets);
  const resources = [];
  const nativeVersions = new Map();
  const versions = config.versions && config.versions.native || [];
  for (let index = 0; index < versions.length; index += 2) {
    nativeVersions.set(Number(versions[index]), versions[index + 1]);
  }
  for (const [uuidIndexText, pathInfo] of Object.entries(config.paths || {})) {
    const resourcePath = pathInfo && pathInfo[0];
    // Crop_*_Seed 是背包物品图标；地块种子阶段由 model/v4/zhongzi 统一提供。
    // 各作物的地上生长资源从 _2 开始，_2.._6 对应发芽到成熟，_7 是枯萎。
    const match = /^model\/v4\/(Crop_\d+)_([2-7])$/.exec(resourcePath || '');
    if (!match || !wanted.has(match[1])) continue;
    const uuidIndex = Number(uuidIndexText);
    const uuid = decodeUuid(config.uuids && config.uuids[uuidIndex]);
    const resource = {
      asset: match[1],
      phase: Number(match[2]),
      uuid,
      nativeHash: nativeVersions.get(uuidIndex) || '',
      resourcePath,
    };
    resources.push(resource);
  }
  return resources.sort((left, right) => left.asset.localeCompare(right.asset) || left.phase - right.phase);
}

function getCommonSeedResource(config) {
  const nativeVersions = versionMap(config, 'native');
  for (const [uuidIndexText, pathInfo] of Object.entries(config.paths || {})) {
    if (!pathInfo || pathInfo[0] !== 'model/v4/zhongzi') continue;
    const uuidIndex = Number(uuidIndexText);
    return {
      asset: '__common',
      phase: 'seed',
      uuid: decodeUuid(config.uuids && config.uuids[uuidIndex]),
      nativeHash: nativeVersions.get(uuidIndex) || '',
      resourcePath: pathInfo[0],
    };
  }
  return null;
}

function findSpriteFrameRect(entries, resource) {
  const marker = `/plant/import/${resource.uuid.slice(0, 2)}/${resource.uuid}@`;
  const candidates = entries
    .filter(entry => entry.url.includes(marker) && entry.url.endsWith('.json'))
    .sort((left, right) => right.lastTime - left.lastTime);
  for (const entry of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(entry.localPath, 'utf8'));
      const pending = [data];
      while (pending.length) {
        const value = pending.pop();
        if (value && typeof value === 'object') {
          if (value.name === 'zhongzi' && value.rect) return value.rect;
          pending.push(...Object.values(value));
        }
      }
    } catch {}
  }
  return null;
}

function downloadAstc(resource, configUrl, targetDir) {
  if (!resource.nativeHash) return null;
  const bundleBase = configUrl.replace(/config\.[^/]+\.json$/, '');
  const url = `${bundleBase}native/${resource.uuid.slice(0, 2)}/${resource.uuid}.${resource.nativeHash}.astc`;
  const target = path.join(targetDir, `${resource.asset}-${resource.phase}.astc`);
  const result = spawnSync('curl', ['-L', '--fail', '--silent', '--show-error', '--output', target, url], { stdio: 'inherit' });
  return result.status === 0 && fs.existsSync(target) ? { url, localPath: target, lastTime: Date.now() } : null;
}

function versionMap(config, kind) {
  const result = new Map();
  const versions = config.versions && config.versions[kind] || [];
  for (let index = 0; index < versions.length; index += 2) {
    result.set(Number(versions[index]), versions[index + 1]);
  }
  return result;
}

function downloadFile(url, target) {
  const result = spawnSync('curl', ['-L', '--fail', '--silent', '--show-error', '--output', target, url], { stdio: 'inherit' });
  return result.status === 0 && fs.existsSync(target);
}

function addDownloadedSpineEntries(entries, configEntry, plants, wantedAssets, targetDir) {
  if (!configEntry) {
    console.warn('跳过 Spine 下载：未找到 mainscene Bundle 配置');
    return;
  }
  const config = JSON.parse(fs.readFileSync(configEntry.localPath, 'utf8'));
  const bundleBase = configEntry.url.replace(/config\.[^/]+\.json$/, '');
  const importVersions = versionMap(config, 'import');
  const nativeVersions = versionMap(config, 'native');
  const uuidIndexes = new Map();
  for (const [index, uuid] of (config.uuids || []).entries()) {
    const decoded = decodeUuid(uuid);
    if (!uuidIndexes.has(decoded) || nativeVersions.has(index)) uuidIndexes.set(decoded, index);
  }
  const resources = new Map();
  for (const [indexText, pathInfo] of Object.entries(config.paths || {})) {
    const resourcePath = pathInfo && pathInfo[0];
    if (Number(pathInfo && pathInfo[1]) === 3 && plants.some(plant => plant.all_state_spine === resourcePath)) {
      resources.set(resourcePath, Number(indexText));
    }
  }
  const selectedPlants = plants.filter(plant => {
    const assetName = plant.asset_name || (Number(plant.seed_id) > 20000 ? `Crop_${Number(plant.seed_id) - 20000}` : `Plant_${plant.id}`);
    return wantedAssets.has(assetName) || wantedAssets.has(`Plant_${plant.id}`);
  });
  if (selectedPlants.length) console.log(`检查 Spine 资源：${selectedPlants.map(plant => plant.name).join('、')}`);
  for (const plant of plants) {
    const assetName = plant.asset_name || (Number(plant.seed_id) > 20000 ? `Crop_${Number(plant.seed_id) - 20000}` : `Plant_${plant.id}`);
    if (!wantedAssets.has(assetName) && !wantedAssets.has(`Plant_${plant.id}`)) continue;
    const skeletonIndex = resources.get(plant.all_state_spine);
    const skeletonUuid = decodeUuid(config.uuids && config.uuids[skeletonIndex]);
    const importHash = importVersions.get(skeletonIndex);
    if (!skeletonUuid || !importHash) {
      console.warn(`跳过 Spine 下载：${plant.name} 未找到官方资源版本`);
      continue;
    }
    const importUrl = `${bundleBase}import/${skeletonUuid.slice(0, 2)}/${skeletonUuid}.${importHash}.json`;
    let importEntry = entries.find(entry => entry.url === importUrl);
    if (!importEntry) {
      const localPath = path.join(targetDir, `${plant.id}-spine.json`);
      if (!downloadFile(importUrl, localPath)) continue;
      importEntry = { url: importUrl, localPath, lastTime: Date.now() };
      entries.push(importEntry);
    }
    try {
      const data = JSON.parse(fs.readFileSync(importEntry.localPath, 'utf8'));
      const textureUuid = decodeUuid(data[1] && data[1][0]);
      const textureIndex = uuidIndexes.get(textureUuid);
      const nativeHash = nativeVersions.get(textureIndex);
      if (!textureUuid || !nativeHash) continue;
      const textureUrl = `${bundleBase}native/${textureUuid.slice(0, 2)}/${textureUuid}.${nativeHash}.png`;
      if (!entries.some(entry => entry.url === textureUrl)) {
        const localPath = path.join(targetDir, `${plant.id}-spine.png`);
        if (downloadFile(textureUrl, localPath)) entries.push({ url: textureUrl, localPath, lastTime: Date.now() });
      }
    } catch {}
  }
}

function findAstc(entries, resource) {
  const marker = `/plant/native/${resource.uuid.slice(0, 2)}/${resource.uuid}.`;
  return entries
    .filter(entry => entry.url.includes(marker) && entry.url.endsWith('.astc'))
    .sort((left, right) => right.lastTime - left.lastTime)[0] || null;
}

function decodeResource(astcenc, source, output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const result = spawnSync(astcenc, ['-dl', source, output], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ASTC转换失败：${source}\n${result.stderr || result.stdout}`);
  }
}

function parseAtlasRegions(atlasText) {
  const regions = new Map();
  const lines = String(atlasText || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const name = lines[index];
    if (!name || /^\s/.test(name) || !/^\s+rotate:/.test(lines[index + 1] || '')) continue;
    const values = {};
    for (let cursor = index + 1; cursor < lines.length && /^\s/.test(lines[cursor]); cursor += 1) {
      const line = lines[cursor].trim();
      const separator = line.indexOf(':');
      if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1).trim();
    }
    const pair = key => String(values[key] || '').split(',').map(value => Number(value.trim()));
    const [x, y] = pair('xy');
    const [width, height] = pair('size');
    if ([x, y, width, height].every(Number.isFinite)) {
      regions.set(name, { x, y, width, height, rotate: values.rotate === 'true' });
    }
  }
  return regions;
}

function findSpineImports(entries) {
  const importsByPlantId = new Map();
  for (const entry of entries.filter(item => /\/mainscene\/import\/.+\.json$/i.test(item.url))) {
    try {
      const data = JSON.parse(fs.readFileSync(entry.localPath, 'utf8'));
      const record = Array.isArray(data) && data[5] && data[5][0];
      const atlasText = record && record.find(value => typeof value === 'string' && value.includes('\n  rotate:'));
      if (record && atlasText) {
        const plantId = Number(record[1]);
        const current = importsByPlantId.get(plantId);
        if (!current || entry.lastTime > current.entry.lastTime) {
          importsByPlantId.set(plantId, { plantId, data, atlasText, entry });
        }
      }
    } catch {}
  }
  return [...importsByPlantId.values()];
}

function findSpineTexture(entries, spineImport) {
  const textureRef = spineImport.data[1] && spineImport.data[1][0];
  const textureUuid = decodeUuid(textureRef);
  const marker = `/mainscene/native/${textureUuid.slice(0, 2)}/${textureUuid}.`;
  return entries
    .filter(entry => entry.url.includes(marker) && /\.png$/i.test(entry.url))
    .sort((left, right) => right.lastTime - left.lastTime)[0] || null;
}

function extractAtlasRegion(texturePath, region, outputPath) {
  if (!commandExists('ffmpeg')) throw new Error('导出 2x2 Spine 作物需要 ffmpeg');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const cropWidth = region.rotate ? region.height : region.width;
  const cropHeight = region.rotate ? region.width : region.height;
  const filter = `crop=${cropWidth}:${cropHeight}:${region.x}:${region.y}${region.rotate ? ',transpose=1' : ''}`;
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', texturePath,
    '-vf', filter, '-frames:v', '1', '-y', outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Spine 图集拆图失败：${result.stderr || outputPath}`);
}

function exportCachedSpinePlants(entries, output, manifest, wantedAssets) {
  const plants = filterInvalidPlants([
    ...JSON.parse(fs.readFileSync(path.join(coreRoot, 'src', 'gameConfig', 'Plant.json'), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(coreRoot, 'src', 'gameConfig', 'EventPlants.json'), 'utf8')),
  ]);
  const plantsById = new Map(plants.filter(plant => Number(plant.size) === 2).map(plant => [Number(plant.id), plant]));
  let exported = 0;
  for (const spineImport of findSpineImports(entries)) {
    const plant = plantsById.get(spineImport.plantId);
    const texture = plant && findSpineTexture(entries, spineImport);
    if (!plant || !texture) continue;
    const assetName = plant.asset_name || (Number(plant.seed_id) > 20000 ? `Crop_${Number(plant.seed_id) - 20000}` : `Plant_${plant.id}`);
    if (!wantedAssets.has(assetName) && !wantedAssets.has(`Plant_${plant.id}`)) continue;
    const regions = parseAtlasRegions(spineImport.atlasText);
    const spineCropName = `Crop_${String(plant.all_state_spine || '').split('/').pop().replace(/^\D+/, '')}`;
    const phaseRegions = new Map([
      // Spine 图集里的 zhongzi 是背包种子图标；阶段1没有地上植物贴图。
      [2, ['grow_02', 'grow_1', '02', '2', `${assetName}_2`, `${spineCropName}_2`]],
      [3, ['grow_03', 'grow_2', '03', '3', `${assetName}_3`, `${spineCropName}_3`]],
      [4, ['grow_04', 'grow_3', '04', '4', `${assetName}_4`, `${spineCropName}_4`]],
      [5, ['grow_05', 'grow_4', '05', '5', `${assetName}_5`, `${spineCropName}_5`]],
      [7, ['kuwei', '07', 'kuwei_tiangong', 'kuwei_tiangong2']],
    ]);
    for (const [phase, regionNames] of phaseRegions) {
      const regionName = regionNames.find(name => regions.has(name))
        || (phase >= 2 && phase <= 5
          ? [...regions.keys()].find(name => new RegExp(`^Crop_\\d+_${phase}$`).test(name))
          : null);
      const region = regionName && regions.get(regionName);
      if (!region) continue;
      const relative = path.join(assetName, `${phase}.png`);
      extractAtlasRegion(texture.localPath, region, path.join(output, relative));
      manifest[assetName] ||= {};
      manifest[assetName][phase] = `/game-config/plant_images/${relative.split(path.sep).join('/')}`;
      exported += 1;
      console.log(`已导出 Spine：${plant.name} ${regionName} -> ${relative}`);
    }
    const seedImageDir = path.join(coreRoot, 'src', 'gameConfig', 'seed_images_named');
    const matureIcon = Number(plant.seed_id) > 0
      ? fs.readdirSync(seedImageDir)
        .filter(name => name.startsWith(`${plant.seed_id}_`) && name.includes(assetName) && /_Seed\.png$/i.test(name))
        .map(name => path.join(seedImageDir, name))[0] || ''
      : '';
    if (matureIcon && fs.existsSync(matureIcon)) {
      const relative = path.join(assetName, '6.png');
      fs.copyFileSync(matureIcon, path.join(output, relative));
      manifest[assetName][6] = `/game-config/plant_images/${relative.split(path.sep).join('/')}`;
      exported += 1;
      console.log(`已导出 Spine：${plant.name} 成熟静态帧 -> ${relative}`);
    } else if (manifest[assetName] && manifest[assetName][5]) {
      const relative = path.join(assetName, '6.png');
      fs.copyFileSync(path.join(output, assetName, '5.png'), path.join(output, relative));
      manifest[assetName][6] = `/game-config/plant_images/${relative.split(path.sep).join('/')}`;
      exported += 1;
      console.log(`已导出 Spine：${plant.name} 成熟静态回退帧 -> ${relative}`);
    }
  }
  return exported;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const cacheRoots = getQqGameCacheRoots();
  if (!cacheRoots.length) throw new Error('未找到 QQ 农场 gamecaches');
  const entries = loadCacheEntries(cacheRoots);
  const latestConfig = findLatestPlantConfig(entries);
  if (!latestConfig) throw new Error('未找到 plant Bundle配置');
  const config = JSON.parse(fs.readFileSync(latestConfig.localPath, 'utf8'));
  const assets = getAssets(args);
  const resources = getPhaseResources(config, assets);
  const commonSeedResource = getCommonSeedResource(config);
  const astcenc = resolveAstcenc(args);
  const manifest = {};
  const manifestPath = path.join(args.output, 'manifest.json');
  if (fs.existsSync(manifestPath)) Object.assign(manifest, JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  // 移除旧的错位阶段，避免重新导出后残留 _Seed 或第 7 档键。
  for (const asset of assets) delete manifest[asset];
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-plant-download.'));
  if (args.downloadMissing) {
    const allPlants = filterInvalidPlants([
      ...JSON.parse(fs.readFileSync(path.join(coreRoot, 'src', 'gameConfig', 'Plant.json'), 'utf8')),
      ...JSON.parse(fs.readFileSync(path.join(coreRoot, 'src', 'gameConfig', 'EventPlants.json'), 'utf8')),
    ]).filter(plant => Number(plant.size) === 2 && plant.all_state_spine);
    addDownloadedSpineEntries(entries, findLatestMainsceneConfig(entries), allPlants, new Set(assets), downloadDir);
  }
  let exported = 0;
  let missing = 0;

  if (commonSeedResource) {
    const cached = findAstc(entries, commonSeedResource)
      || (args.downloadMissing ? downloadAstc(commonSeedResource, latestConfig.url, downloadDir) : null);
    if (cached) {
      const relative = path.join('common', 'seed.png');
      const decoded = path.join(downloadDir, 'common-seed-full.png');
      const spriteRect = findSpriteFrameRect(entries, commonSeedResource);
      if (!spriteRect) throw new Error('未找到 model/v4/zhongzi 的官方 SpriteFrame 裁剪信息');
      decodeResource(astcenc, cached.localPath, decoded);
      extractAtlasRegion(decoded, {
        x: Number(spriteRect.x),
        y: Number(spriteRect.y),
        width: Number(spriteRect.width),
        height: Number(spriteRect.height),
        rotate: false,
      }, path.join(args.output, relative));
      manifest.__common = { seed: `/game-config/plant_images/${relative.split(path.sep).join('/')}` };
      exported += 1;
      console.log(`已导出：${commonSeedResource.resourcePath} -> ${relative}`);
    } else {
      missing += 1;
      console.warn(`跳过（本地未缓存）：${commonSeedResource.resourcePath}`);
    }
  }

  for (const resource of resources) {
    const cached = findAstc(entries, resource)
      || (args.downloadMissing ? downloadAstc(resource, latestConfig.url, downloadDir) : null);
    if (!cached) {
      missing += 1;
      console.warn(`跳过（本地未缓存）：${resource.resourcePath}`);
      continue;
    }
    const relative = path.join(resource.asset, `${resource.phase}.png`);
    decodeResource(astcenc, cached.localPath, path.join(args.output, relative));
    manifest[resource.asset] ||= {};
    manifest[resource.asset][resource.phase] = `/game-config/plant_images/${relative.split(path.sep).join('/')}`;
    exported += 1;
    console.log(`已导出：${resource.resourcePath} -> ${relative}`);
  }

  exported += exportCachedSpinePlants(entries, args.output, manifest, new Set(assets));

  fs.mkdirSync(args.output, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`完成：导出 ${exported} 个阶段，未缓存 ${missing} 个阶段`);
  console.log(`Bundle配置：${latestConfig.url}`);
  console.log(`清单：${manifestPath}`);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}
