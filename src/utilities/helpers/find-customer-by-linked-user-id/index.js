const { Customer } = require("../../../models/customers");

function findCustomerByLinkedUserId(userId) {
  return Customer.findOne(Customer.notDeletedFilter({ linkedUserId: userId }));
}

module.exports = findCustomerByLinkedUserId;
