const { exceptionHandler } = require("../../utilities/handlers");

/**
 * Wrap any Joi schema as request-body validation middleware — every
 * module's routes use this the same way instead of each controller
 * hand-rolling its own `schema.validateAsync(req.body)` try/catch.
 */
function validateBody(schema) {
  const middleware = async (req, res, next) => {
    try {
      req.body = await schema.validateAsync(req.body, { abortEarly: false, stripUnknown: true });
      next();
    } catch (err) {
      const message = err.details ? err.details.map((d) => d.message).join(" · ") : err.message;
      return exceptionHandler({ res, error: message, statusCode: 422 });
    }
  };

  // Named so it shows up when auditing the router stack — see require-permission.js.
  Object.defineProperty(middleware, "name", { value: "validateBody" });
  return middleware;
}

module.exports = validateBody;