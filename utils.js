
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
 * Modify the http response for pagination, return 2 properties to use in a query
 *
 * @url https://github.com/begriffs/clean_pagination
 * @url http://nodejs.org/api/http.html#http_class_http_clientrequest
 * @url http://nodejs.org/api/http.html#http_class_http_serverresponse
 *
 *
 * @param	{http.ClientRequest}	req				http request to get headers from
 * @param	{http.ServerResponse}	res				http response to complete
 * @param	{int}					totalItems 	    total number of items available, can be Infinity
 * @param	{int}					maxRangeSize
 *
 * @return {Object}
 * 			.limit	Number of items to return
 * 			.skip	Zero based position for the first item to return
 */
const paginate = function(req, res, totalItems, maxRangeSize) {
  /**
   * Parse requested range
   */
  function parseRange(hdr) {
    var m = hdr && hdr.match(/^(\d+)-(\d*)$/);
    if (!m) {
      return null;
    }
    return {
      from: parseInt(m[1]),
      to: m[2] ? parseInt(m[2]) : Infinity,
    };
  }

  res.setHeader('Accept-Ranges', 'items');
  res.setHeader('Range-Unit', 'items');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Range-Unit');

  maxRangeSize = parseInt(maxRangeSize);

  var range = {
    from: 0,
    to: (totalItems - 1),
  };

  if ('items' === req.headers['range-unit']) {
    var parsedRange = parseRange(req.headers.range);
    if (parsedRange) {
      range = parsedRange;
    }
  }

  if ((null !== range.to && range.from > range.to) || (range.from > 0 && range.from >= totalItems)) {
    if (totalItems > 0 || range.from !== 0) {
      res.statusCode = 416; // Requested range unsatisfiable
    }
 else {
      res.statusCode = 204; // No content
    }
    res.setHeader('Content-Range', `*/${  totalItems}`);
    return;
  }

  var availableTo;
  var reportTotal;

  if (totalItems < Infinity) {
    availableTo = Math.min(
      range.to,
      totalItems - 1,
      range.from + maxRangeSize - 1
    );

    reportTotal = totalItems;
  }
 else {
    availableTo = Math.min(
      range.to,
      range.from + maxRangeSize - 1
    );

    reportTotal = '*';
  }

  res.setHeader('Content-Range', `${range.from  }-${  availableTo  }/${  reportTotal}`);

  var availableLimit = availableTo - range.from + 1;

  if (0 === availableLimit) {
    res.statusCode = 204; // no content
    res.setHeader('Content-Range', '*/0');
    return;
  }

  if (availableLimit < totalItems) {
    res.statusCode = 206; // Partial contents
  }
 else {
    res.statusCode = 200; // OK (all items)
  }

  // Links
  function buildLink(rel, itemsFrom, itemsTo) {
    var to = itemsTo < Infinity ? itemsTo : '';
    return `<${  req.url  }>; rel="${  rel  }"; items="${  itemsFrom  }-${  to  }"`;
  }

  var requestedLimit = range.to - range.from + 1;
  var links = [];

  if (availableTo < totalItems - 1) {
    links.push(buildLink('next',
      availableTo + 1,
      availableTo + requestedLimit
    ));

    if (totalItems < Infinity) {
      var lastStart = Math.floor((totalItems - 1) / availableLimit) * availableLimit;

      links.push(buildLink('last',
        lastStart,
        lastStart + requestedLimit - 1
      ));
    }
  }

  if (range.from > 0) {
    var previousFrom = Math.max(0, range.from - Math.min(requestedLimit, maxRangeSize));
    links.push(buildLink('prev',
      previousFrom,
      previousFrom + requestedLimit - 1
    ));

    links.push(buildLink('first',
      0,
      requestedLimit - 1
    ));
  }

  res.setHeader('Link', links.join(', '));

  // return values named from mongoose methods
  return {
    limit: availableLimit,
    skip: range.from,
  };
};

module.exports = { zipObject, isObjectLike, isEmpty, get, set, paginate };
