// Thrown for expected 4xx outcomes — including from inside a transaction,
// where throwing is also what rolls the transaction back.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Express 4 doesn't catch rejected promises from async handlers.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// The single 404 every tab route uses for "doesn't exist / not yours / you
// left" — identical wording and status so they can't be told apart.
const NOT_FOUND = () => new HttpError(404, "Tab not found.");

module.exports = { HttpError, asyncHandler, NOT_FOUND };
