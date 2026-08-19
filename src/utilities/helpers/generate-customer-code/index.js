const { nextSequence } = require("../../../common/utils/sequence");

const CODE_PREFIX = "SSD-C";
const CODE_PAD_LENGTH = 4;

async function generateCustomerCode() {
  const n = await nextSequence("customerCode");
  return `${CODE_PREFIX}${String(n).padStart(CODE_PAD_LENGTH, "0")}`;
}

module.exports = generateCustomerCode;
