
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

module.exports = { zipObject, isObjectLike, isEmpty, get, set };
