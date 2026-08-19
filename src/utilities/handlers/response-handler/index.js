/**
 * One shape for every successful response, used by every controller in
 * every module — so the frontend never has to guess whether a given
 * endpoint returns `{ data }`, `{ result }`, or the raw object.
 */
function responseHandler({ res, response = null, successMessage = "Success", statusCode = 200 }) {
  return res.status(statusCode).json({
    success: true,
    message: successMessage,
    data: response,
  });
}

module.exports = responseHandler;
