const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getMutantDisplayPlantId,
    getMutantPlantImageByPhase,
    getPlantImageByPhase,
} = require('../src/config/gameConfig');

test('活动植物按阶段返回官方植物图片', () => {
    const image = getPlantImageByPhase(1021037, 6);
    assert.equal(image, '/game-config/plant_images/Crop_1037/6.png');
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', image.replace('/game-config/', 'gameConfig/'))), true);
});

test('2x2 Spine 活动植物可返回完整的静态阶段图', () => {
    assert.equal(getPlantImageByPhase(1029003, 1), '/game-config/plant_images/common/seed.png');
    for (let phase = 2; phase <= 7; phase += 1) {
        const image = getPlantImageByPhase(1029003, phase);
        assert.equal(image, `/game-config/plant_images/Crop_9003/${phase}.png`);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', image.replace('/game-config/', 'gameConfig/'))), true);
    }
});

test('所有作物的土地种子阶段共用客户端通用种子贴图', () => {
    const seedImage = '/game-config/plant_images/common/seed.png';
    assert.equal(getPlantImageByPhase(1020128, 1), seedImage);
    assert.equal(getPlantImageByPhase(1026032, 1), seedImage);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', seedImage.replace('/game-config/', 'gameConfig/'))), true);
});

test('变异植物映射优先选择完整组合', () => {
    assert.equal(getMutantDisplayPlantId(1029003, [5]), 1129003);
    assert.equal(getMutantDisplayPlantId(1029003, [11]), 1028003);
    assert.equal(getMutantDisplayPlantId(1029003, [5, 11]), 1128003);
    assert.equal(getMutantDisplayPlantId(1028003, [5, 11]), 1128003);
    assert.equal(getMutantDisplayPlantId(1029004, [16]), 1028004);
    assert.equal(getMutantDisplayPlantId(1029004, [5, 16]), 1128004);
    assert.equal(getMutantDisplayPlantId(1028004, [5, 16]), 1128004);
});

test('变异植物使用专属阶段图并在缺失时回退原作物', () => {
    assert.equal(
        getMutantPlantImageByPhase(1028003, [5, 11], 7),
        '/game-config/plant_images/Plant_1128003/7.png',
    );
    assert.equal(
        getMutantPlantImageByPhase(1029003, [5], 6),
        '/game-config/plant_images/Plant_1129003/6.png',
    );
    assert.equal(
        getMutantPlantImageByPhase(1029004, [16], 6),
        '/game-config/plant_images/Plant_1028004/6.png',
    );
    assert.equal(
        getMutantPlantImageByPhase(1029004, [5, 16], 6),
        '/game-config/plant_images/Plant_1128004/6.png',
    );
});

test('乐园变异包含本地官方阶段素材', () => {
    for (const [plantId, mutantIds] of [[1029004, [16]], [1029004, [5, 16]]]) {
        for (let phase = 2; phase <= 7; phase += 1) {
            const image = getMutantPlantImageByPhase(plantId, mutantIds, phase);
            assert.match(image, /^\/game-config\/plant_images\/Plant_/);
            assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', image.replace('/game-config/', 'gameConfig/'))), true);
        }
    }
});

test('supplemental crops resolve local seed icons and every growth phase', () => {
    const { getPlantBySeedId, getSeedImageBySeedId } = require('../src/config/gameConfig');
    for (const [seedId, asset, size] of [[20516, 'Crop_516', 1], [25995, 'Crop_5995', 1], [29004, 'Crop_9004', 2], [20522, 'Crop_522', 1], [20523, 'Crop_523', 1]]) {
        const plant = getPlantBySeedId(seedId);
        assert.equal(plant?.size, size);
        const seedImage = getSeedImageBySeedId(seedId);
        assert.equal(seedImage, `/game-config/seed_images_named/${seedId}_${asset}_Seed.png`);
        const images = [seedImage];
        assert.equal(getPlantImageByPhase(plant.id, 1), '/game-config/plant_images/common/seed.png');
        for (let phase = 2; phase <= (size === 2 ? 7 : 6); phase += 1) {
            const image = getPlantImageByPhase(plant.id, phase);
            assert.equal(image, `/game-config/plant_images/${asset}/${phase}.png`);
            images.push(image);
        }
        for (const image of images) {
            const bytes = fs.readFileSync(path.join(__dirname, '..', 'src', image.replace('/game-config/', 'gameConfig/')));
            assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        }
    }
});
