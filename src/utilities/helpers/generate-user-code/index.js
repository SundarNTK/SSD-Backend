const { nextSequence } = require("../../../common/utils/sequence");

async function generateUserCode() {
  const n = await nextSequence("userCode");
  return `SSD-U${n}`;
}

module.exports = generateUserCode;
