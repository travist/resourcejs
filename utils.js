
const zipObject = (props, values) => props.reduce((prev, prop, i) => Object.assign(prev, { [prop]: values[i] }), {});

const isObjectLike = (obj) => obj !== null && typeof obj === 'object';

const get = (obj, path, defaultValue) => path.split('.').reduce((a, c) => (a && a[c] ? a[c] : (defaultValue || null)), obj);

const set = (obj, path, value) => {
    if (Object(obj) !== obj) return obj;
    // If not yet an array, get the keys from the string-path
    if (!Array.isArray(path)) path = path.toString().match(/[^.[\]]+/g) || [];
    // Split the path. Note: last index is the value key
    path.slice(0,-1).reduce((a, c, i) =>
         Object(a[c]) === a[c] // Does the key exist and is its value an object?
             // Yes: then follow that path
             ? a[c]
             // No: create the key. Is the next key a potential array-index?
             : a[c] = Math.abs(path[i+1])>>0 === +path[i+1]
                   ? [] // Yes: assign a new array object
                   : {}, // No: assign a new plain object
         obj)[path[path.length-1]] = value; // Finally assign the value to the last key
    return obj;
};

const isEmpty = (obj) => {
  return !obj || (Object.entries(obj).length === 0 && obj.constructor === Object);
};

/**
 * Recursively removes properties whose keys start with '$' from an object or array.
 * This version preserves the original object's prototype chain and property descriptors
 * (including getters and setters) for generic objects.
 *
 * It returns a new, sanitized object or array without modifying the original.
 *
 * @param {any} params - The object or array to clean.
 * @returns {any} A new object/array with '$' properties removed, or the original primitive value/uncleanable object type.
 */
const sanitizeQueryParameters = (params) => {
  if (params === null || typeof params !== 'object') {
    return params;
  }

  if (Array.isArray(params)) {
    return params.map(item => sanitizeQueryParameters(item));
  }

  const cleanedObject = Object.create(Object.getPrototypeOf(params));

  for (const key in params) {
    if (Object.hasOwn(params, key)) {
      if (key.startsWith('$')) {
        continue;
      }

      // 4. Get the full property descriptor for the current key.
      const descriptor = Object.getOwnPropertyDescriptor(params, key);

      // 5. If it's a data property (has a 'value'), recursively sanitize its value.
      if ('value' in descriptor) {
        descriptor.value = sanitizeQueryParameters(descriptor.value);
      }
      // If it's an accessor property (getter/setter), the getter/setter functions
      // themselves are copied as they are, preserving the object's behavior.
      // Sanitizing the *result* of a getter would require calling it, which can
      // alter semantics and is a more complex use case.

      // 6. Define the property on the new cleaned object using its (potentially updated) descriptor.
      Object.defineProperty(cleanedObject, key, descriptor);
    }
  }

  return cleanedObject;
};

module.exports = { zipObject, isObjectLike, isEmpty, get, set, sanitizeQueryParameters };
