const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getItemById, getItemImageById, getPlantByFruitId } = require('../src/config/gameConfig');
const sources = require('../src/gameConfig/seed_images_named/illustrated-fruit-sources.json');

test('missing illustrated fruits resolve official names and intact local images', () => {
  const expected = new Map([
    [1046030, '黄金·月下美人'], [40435, '山丹丹'], [46030, '月下美人'],
    [1040516, '黄金·狗尾草'], [1041072, '黄金·寒兰'],
    [1041625, '黄金·枸杞'],
    [1045995, '黄金·芦苇'],
    [204008, '比熊棉花糖'], [204009, '黄金·比熊棉花糖'],
    [1049004, '黄金·泡泡棉花糖'], [41072, '寒兰'], [41625, '枸杞'],
  ]);
  for (const [id, name] of expected) {
    assert.equal(getItemById(id)?.name, name);
    assert.equal(getItemImageById(id), `/game-config/seed_images_named/${id}.png`);
  }
  for (const source of sources.items) {
    const bytes = fs.readFileSync(path.join(__dirname, '../src/gameConfig/seed_images_named', source.file));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.sha256);
    assert.match(source.url, /^https:\/\/cdn-resource\.nqf\.qq\.com\//);
  }
});

test('orchid and goji fruits retain single-grid plant and seed relationships', () => {
  for (const [fruit, seed, name] of [[41072, 21072, '寒兰'], [41625, 21625, '枸杞']]) {
    const plant = getPlantByFruitId(fruit);
    assert.equal(plant?.seed_id, seed);
    assert.equal(plant?.size, 1);
    assert.equal(plant?.fruit.count, 48);
    assert.equal(getItemById(seed)?.name, `${name}种子`);
    assert.equal(getItemImageById(seed), `/game-config/seed_images_named/${seed}.png`);
  }
});
