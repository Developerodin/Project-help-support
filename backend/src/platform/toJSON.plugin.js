/**
 * Mongoose plugin. Applied to every model:
 *   - _id  → id
 *   - __v  removed
 *   - any path declared `private: true` removed, at any depth
 */

function deletePath(obj, path, index = 0) {
  if (obj == null) return;
  const key = path[index];
  if (index === path.length - 1) {
    delete obj[key];
    return;
  }
  deletePath(obj[key], path, index + 1);
}

export default function toJSON(schema) {
  const existing = schema.options.toJSON?.transform;

  schema.options.toJSON = {
    ...(schema.options.toJSON || {}),
    transform(doc, ret, options) {
      Object.keys(schema.paths).forEach((path) => {
        if (schema.paths[path].options?.private) {
          deletePath(ret, path.split('.'));
        }
      });

      ret.id = ret._id?.toString();
      delete ret._id;
      delete ret.__v;

      return existing ? existing(doc, ret, options) : ret;
    },
  };
}
