/** Express 4 does not catch rejected promises from async handlers. This does. */
export default function catchAsync(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
