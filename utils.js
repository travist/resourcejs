
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
 * @param {any} params - The object or array to clean.
 * @returns {any} A new object/array with '$' properties removed, or the original primitive value.
 */
const sanitizeQueryParameters = (params) => {
  // If the data is not an object or is null, return it as is.
  if (params === null || typeof params !== 'object') {
    return params;
  }

  // If it's an array, process each element.
  if (Array.isArray(params)) {
    return params.map(item => sanitizeQueryParameters(item));
  }

  // If it's a plain object, iterate over its keys.
  const cleanedObject = {};
  for (const key in params) {
    // Ensure the key is directly on the object and not inherited
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      // If the key does NOT start with '$', include it and recursively clean its value.
      if (!key.startsWith('$')) {
        cleanedObject[key] = sanitizeQueryParameters(params[key]);
      }
      else {
        throw new Error(`[${key}] is not allowed. Please use __${key} instead. Read https://github.com/travist/resourcejs#filtering-the-results for a list of available query arguments`);
      }
    }
  }

  return cleanedObject;
};

module.exports = { zipObject, isObjectLike, isEmpty, get, set, sanitizeQueryParameters };
