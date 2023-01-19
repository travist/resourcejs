'use strict';

const paginate = require('node-paginate-anything');
const jsonpatch = require('fast-json-patch');
const mongodb = require('mongodb');
const moment = require('moment');
const parseRange = require('range-parser');
const debug = {
  query: require('debug')('resourcejs:query'),
  index: require('debug')('resourcejs:index'),
  get: require('debug')('resourcejs:get'),
  put: require('debug')('resourcejs:put'),
  post: require('debug')('resourcejs:post'),
  patch: require('debug')('resourcejs:patch'),
  delete: require('debug')('resourcejs:delete'),
  virtual: require('debug')('resourcejs:virtual'),
  respond: require('debug')('resourcejs:respond'),
};
const utils = require('./utils');

class Resource {
  constructor(app, route, modelName, model, options) {
    this.app = app;
    this.options = options || {};
    if (this.options.convertIds === true) {
      this.options.convertIds = /(^|\.)_id$/;
    }
    this.name = modelName.toLowerCase();
    this.model = model;
    this.modelName = modelName;
    this.route = `${route}/${this.name}`;
    this.methods = [];
    this._swagger = null;
  }

  /**
   * Maintain reverse compatibility.
   *
   * @param app
   * @param method
   * @param path
   * @param callback
   * @param last
   * @param options
   */
  register(app, method, path, callback, last, options) {
    this.app = app;
    return this._register(method, path, callback, last, options);
  }

  /**
   * Add a stack processor to be able to execute the middleware independently of ExpressJS.
   * Taken from https://github.com/randymized/composable-middleware/blob/master/lib/composable-middleware.js#L27
   *
   * @param stack
   * @return {function(...[*]=)}
   */
  stackProcessor(stack) {
    return (req, res, done) => {
      let layer = 0;
      (function next(err) {
        const fn = stack[layer++];
        if (fn == null) {
          done(err);
        }
        else {
          if (err) {
            switch (fn.length) {
              case 4:
                fn(err, req, res, next);
                break;
              case 2:
                fn(err, next);
                break;
              default:
                next(err);
                break;
            }
          }
          else {
            switch (fn.length) {
              case 3:
                fn(req, res, next);
                break;
              case 1:
                fn(next);
                break;
              default:
                next();
                break;
            }
          }
        }
      })();
    };
  }

  /**
   * Register a new callback but add before and after options to the middleware.
   *
   * @param method
   * @param path
   * @param callback
   * @param last
   * @param options
   */
  _register(method, path, callback, last, options) {
    let routeStack = [];
    // The before middleware.
    if (options && options.before) {
      const before = options.before.map((m) => m.bind(this));
      routeStack = [...routeStack, ...before];
    }

    routeStack = [...routeStack, callback.bind(this)];

    // The after middleware.
    if (options && options.after) {
      const after = options.after.map((m) => m.bind(this));
      routeStack = [...routeStack, ...after];
    }

    routeStack = [...routeStack, last.bind(this)];

    // Add a fallback error handler.
    const error = (err, req, res, next) => {
      if (err) {
        res.status(400).json({
          status: 400,
          message: err.message || err,
        });
      }
      else {
        return next();
      }
    };

    routeStack = [...routeStack, error.bind(this)]

    // Declare the resourcejs object on the app.
    if (!this.app.resourcejs) {
      this.app.resourcejs = {};
    }

    if (!this.app.resourcejs[path]) {
      this.app.resourcejs[path] = {};
    }

    // Add a stack processor so this stack can be executed independently of Express.
    this.app.resourcejs[path][method] = this.stackProcessor(routeStack);

    // Apply these callbacks to the application.
    switch (method) {
      case 'get':
        this.app.get(path, routeStack);
        break;
      case 'post':
        this.app.post(path, routeStack);
        break;
      case 'put':
        this.app.put(path, routeStack);
        break;
      case 'patch':
        this.app.patch(path, routeStack);
        break;
      case 'delete':
        this.app.delete(path, routeStack);
        break;
    }
  }

  /**
   * Sets the different responses and calls the next middleware for
   * execution.
   *
   * @param res
   *   The response to send to the client.
   * @param next
   *   The next middleware
   */
  static respond(req, res, next) {
    if (req.noResponse || res.headerSent || res.headersSent) {
      debug.respond('Skipping');
      return next();
    }

    if (res.resource) {
      switch (res.resource.status) {
        case 404:
          res.status(404).json({
            status: 404,
            errors: ['Resource not found'],
          });
          break;
        case 400:
        case 500:
          const errors = {};
          for (let property in res.resource.error.errors) {
            if (res.resource.error.errors.hasOwnProperty(property)) {
              const error = res.resource.error.errors[property];
              const { path, name, message } = error;
              res.resource.error.errors[property] = { path, name, message };
            }
          }
          res.status(res.resource.status).json({
            status: res.resource.status,
            message: res.resource.error.message,
            errors: res.resource.error.errors,
          });
          break;
        case 204:
          // Convert 204 into 200, to preserve the empty result set.
          // Update the empty response body based on request method type.
          debug.respond(`204 -> ${req.__rMethod}`);
          switch (req.__rMethod) {
            case 'index':
              res.status(200).json([]);
              break;
            default:
              res.status(200).json({});
              break;
          }
          break;
        default:
          res.status(res.resource.status).json(res.resource.item);
          break;
      }
    }

    next();
  }

  static ObjectId(id) {
    try {
      return (new mongodb.ObjectId(id));
    }
    catch (e) {
      return id;
    }
  }

  /**
   * Sets the response that needs to be made and calls the next middleware for
   * execution.
   *
   * @param res
   * @param resource
   * @param next
   */
  static setResponse(res, resource, next) {
    res.resource = resource;
    next();
  }

  /**
   * Returns the method options for a specific method to be executed.
   * @param method
   * @param options
   * @returns {{}}
   */
  static getMethodOptions(method, options) {
    if (!options) {
      options = {};
    }

    // If this is already converted to method options then return.
    if (options.methodOptions) {
      return options;
    }

    // Uppercase the method.
    method = method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
    const methodOptions = { methodOptions: true };

    // Find all of the options that may have been passed to the rest method.
    const beforeHandlers = options.before ?
      (
        Array.isArray(options.before) ? options.before : [options.before]
      ) :
      [];
    const beforeMethodHandlers = options[`before${method}`] ?
      (
        Array.isArray(options[`before${method}`]) ? options[`before${method}`] : [options[`before${method}`]]
      ) :
      [];
    methodOptions.before = [...beforeHandlers, ...beforeMethodHandlers];

    const afterHandlers = options.after ?
      (
        Array.isArray(options.after) ? options.after : [options.after]
      ) :
      [];
    const afterMethodHandlers = options[`after${method}`] ?
      (
        Array.isArray(options[`after${method}`]) ? options[`after${method}`] : [options[`after${method}`]]
      ) :
      [];
    methodOptions.after = [...afterHandlers, ...afterMethodHandlers];

    // Expose mongoose hooks for each method.
    ['before', 'after'].forEach((type) => {
      const path = `hooks.${method.toString().toLowerCase()}.${type}`;

      utils.set(
        methodOptions,
        path,
        utils.get(options, path, (req, res, item, next) => next())
      );
    });

    // Return the options for this method.
    return methodOptions;
  }

  /**
   * _register the whole REST api for this resource.
   *
   * @param options
   * @returns {*|null|HttpPromise}
   */
  rest(options) {
    return this
      .index(options)
      .get(options)
      .virtual(options)
      .put(options)
      .patch(options)
      .post(options)
      .delete(options);
  }

  /**
   * Returns a query parameters fields.
   *
   * @param req
   * @param name
   * @returns {*}
   */
  static getParamQuery(req, name) {
    if (!Object.prototype.hasOwnProperty.call(req.query, name)) {
      switch (name) {
        case 'populate':
          return '';
        default:
          return null;
      }
    }

    if (name === 'populate' && utils.isObjectLike(req.query[name])) {
      return req.query[name];
    }
    else {
      const query = ( Array.isArray(req.query[name]) ? req.query[name].join(',') : req.query[name] );
      // Generate string of spaced unique keys
      return (query && typeof query === 'string') ? [...new Set(query.match(/[^, ]+/g))].join(' ') : null;
    }
  }

  static getQueryValue(name, value, param, options, selector) {
    if (selector && (selector === 'eq' || selector === 'ne') && (typeof value === 'string')) {
      const lcValue = value.toLowerCase();
      if (lcValue === 'null') {
        return null;
      }
      if (lcValue === '"null"') {
        return 'null';
      }
      if (lcValue === 'true') {
        return true;
      }
      if (lcValue === '"true"') {
        return 'true';
      }
      if (lcValue === 'false') {
        return false;
      }
      if (lcValue === '"false"') {
        return 'false';
      }
    }

    if (param.instance === 'Number') {
      return parseInt(value, 10);
    }

    if (param.instance === 'Date') {
      const date = moment.utc(value, ['YYYY-MM-DD', 'YYYY-MM', 'YYYY', 'x', moment.ISO_8601], true);
      if (date.isValid()) {
        return date.toDate();
      }
    }

    // If this is an ID, and the value is a string, convert to an ObjectId.
    if (
      options.convertIds &&
      name.match(options.convertIds) &&
      (typeof value === 'string') &&
      (mongodb.ObjectId.isValid(value))
    ) {
      try {
        value = Resource.ObjectId(value);
      }
      catch (err) {
        console.warn(`Invalid ObjectId: ${value}`);
      }
    }

    return value;
  }

  /**
   * Get the range of items from headers
   *
   * @param req
   * @param size
   * @returns {Object}
   */
  static getRangeFromHeaders(req, size) {
    if (!req.headers.range) {
      return null;
    }

    const range = parseRange(size, req.headers.range);
    if (range.type !== 'items') {
      return null;
    }

    return range[0];
  }

  /**
   * Get the find query for the index.
   *
   * @param req
   * @returns {Object}
   */
  getFindQuery(req, options, existing) {
    const findQuery = {};
    options = options || this.options;

    // Get the filters and omit the limit, skip, select, sort and populate.
    const {limit, skip, select, sort, populate, ...filters} = req.query;

    // Sets the findQuery property.
    const setFindQuery = function(name, value) {
      // Ensure we do not override any existing query parameters.
      if (!existing || !existing.hasOwnProperty(name)) {
        findQuery[name] = value;
      }
    };

    // Iterate through each filter.
    Object.entries(filters).forEach(([name, value]) => {
      // Get the filter object.
      const filter = utils.zipObject(['name', 'selector'], name.split('__'));

      // See if this parameter is defined in our model.
      const param = this.model.schema.paths[filter.name.split('.')[0]];
      if (param) {
        // See if this selector is a regular expression.
        if (filter.selector === 'regex') {
          // Set the regular expression for the filter.
          const parts = value.match(/\/?([^/]+)\/?([^/]+)?/);
          let regex = null;
          try {
            regex = new RegExp(parts[1], (parts[2] || 'i'));
          }
          catch (err) {
            debug.query(err);
            regex = null;
          }
          if (regex) {
            setFindQuery(filter.name, regex);
          }
          return;
        } // See if there is a selector.
        else if (filter.selector) {
          var filterQuery = findQuery[filter.name];
          // Init the filter.
          if (!filterQuery) {
            filterQuery = {};
          }

          if (filter.selector === 'exists') {
            value = ((value === 'true') || (value === '1')) ? true : value;
            value = ((value === 'false') || (value === '0')) ? false : value;
            value = !!value;
          }
          // Special case for in filter with multiple values.
          else if (['in', 'nin'].includes(filter.selector)) {
            value = Array.isArray(value) ? value : value.split(',');
            value = value.map((item) => Resource.getQueryValue(filter.name, item, param, options, filter.selector));
          }
          else {
            // Set the selector for this filter name.
            value = Resource.getQueryValue(filter.name, value, param, options, filter.selector);
          }

          filterQuery[`$${filter.selector}`] = value;
          setFindQuery(filter.name, filterQuery);
          return;
        }
        else {
          // Set the find query to this value.
          value = Resource.getQueryValue(filter.name, value, param, options, filter.selector);
          setFindQuery(filter.name, value);
          return;
        }
      }

      if (!options.queryFilter) {
        // Set the find query to this value.
        setFindQuery(filter.name, value);
      }
    });

    // Return the findQuery.
    return findQuery;
  }

  countQuery(query, pipeline) {
    // We cannot use aggregation if mongoose special options are used... like populate.
    if (!utils.isEmpty(query._mongooseOptions) || !pipeline) {
      return query;
    }
    const stages = [
      { $match: query.getQuery() },
      ...pipeline,
      {
        $group: {
          _id : null,
          count : { $sum : 1 },
        },
      },
    ];
    return {
      countDocuments(cb) {
        query.model.aggregate(stages).exec((err, items) => {
          if (err) {
            return cb(err);
          }
          return cb(null, items.length ? items[0].count : 0);
        });
      },
    };
  }

  indexQuery(query, pipeline) {
    // We cannot use aggregation if mongoose special options are used... like populate.
    if (!utils.isEmpty(query._mongooseOptions) || !pipeline) {
      return query.lean();
    }

    const stages = [
      { $match: query.getQuery() },
      ...pipeline,
    ];

    if (query.options && query.options.sort && !utils.isEmpty(query.options.sort)) {
      stages.push({ $sort: query.options.sort });
    }
    if (query.options && query.options.skip) {
      stages.push({ $skip: query.options.skip });
    }
    if (query.options && query.options.limit) {
      stages.push({ $limit: query.options.limit });
    }
    if (!utils.isEmpty(query._fields)) {
      stages.push({ $project: query._fields });
    }
    return query.model.aggregate(stages);
  }

  /**
   * The index for a resource.
   *
   * @param options
   */
  index(options) {
    options = Resource.getMethodOptions('index', options);
    this.methods.push('index');
    this._register('get', this.route, (req, res, next) => {
      // Store the internal method for response manipulation.
      req.__rMethod = 'index';

      // Allow before handlers the ability to disable resource CRUD.
      if (req.skipResource) {
        debug.index('Skipping Resource');
        return next();
      }

      // Get the query object.
      let countQuery = req.countQuery || req.modelQuery || req.model || this.model;
      const query = req.modelQuery || req.model || this.model;

      // Make sure to clone the count query if it is available.
      if (typeof countQuery.clone === 'function') {
        countQuery = countQuery.clone();
      }

      // Get the find query.
      const findQuery = this.getFindQuery(req, null, query._conditions);

      // First get the total count.
      this.countQuery(countQuery.find(findQuery), query.pipeline).countDocuments((err, count) => {
        if (err) {
          debug.index(err);
          return Resource.setResponse(res, { status: 400, error: err }, next);
        }

        // Get the default limit.
        const defaults = { limit: 10, skip: 0 };

        const range = Resource.getRangeFromHeaders(req, count);
        if (range) {
          req.query.limit = req.query.limit || (range.end - range.start + 1);
          req.query.skip = req.query.skip || range.start;

          // Delete Range header to recreate it below for 'node-paginate-anything' compatibility
          delete req.headers.range;
        }

        let { limit, skip } = req.query
        limit = parseInt(limit, 10)
        limit = (isNaN(limit) || (limit < 0)) ? defaults.limit : limit
        skip = parseInt(skip, 10)
        skip = (isNaN(skip) || (skip < 0)) ? defaults.skip : skip
        const reqQuery = { limit, skip };

        // If a skip is provided, then set the range headers.
        if (reqQuery.skip && !req.headers.range) {
          req.headers['range-unit'] = 'items';
          req.headers.range = `${reqQuery.skip}-${reqQuery.skip + (reqQuery.limit - 1)}`;
        }

        // Get the page range.
        const pageRange = paginate(req, res, count, reqQuery.limit) || {
          limit: reqQuery.limit,
          skip: reqQuery.skip,
        };

        // Make sure that if there is a range provided in the headers, it takes precedence.
        if (req.headers.range) {
          reqQuery.limit = pageRange.limit;
          reqQuery.skip = pageRange.skip;
        }

        // Next get the items within the index.
        const queryExec = query
          .find(findQuery)
          .limit(reqQuery.limit)
          .skip(reqQuery.skip)
          .select(Resource.getParamQuery(req, 'select'))
          .sort(Resource.getParamQuery(req, 'sort'));

        // Only call populate if they provide a populate query.
        const populate = Resource.getParamQuery(req, 'populate');
        if (populate) {
          debug.index(`Populate: ${populate}`);
          queryExec.populate(populate);
        }

        options.hooks.index.before.call(
          this,
          req,
          res,
          findQuery,
          () => this.indexQuery(queryExec, query.pipeline).exec((err, items) => {
            if (err) {
              debug.index(err);
              debug.index(err.name);

              if (err.name === 'CastError' && populate) {
                err.message = `Cannot populate "${populate}" as it is not a reference in this resource`;
                debug.index(err.message);
              }

              return Resource.setResponse(res, { status: 400, error: err }, next);
            }

            debug.index(items);
            options.hooks.index.after.call(
              this,
              req,
              res,
              items,
              Resource.setResponse.bind(Resource, res, { status: res.statusCode, item: items }, next)
            );
          })
        );
      });
    }, Resource.respond, options);
    return this;
  }

  /**
   * Register the GET method for this resource.
   */
  get(options) {
    options = Resource.getMethodOptions('get', options);
    this.methods.push('get');
    this._register('get', `${this.route}/:${this.name}Id`, (req, res, next) => {
      // Store the internal method for response manipulation.
      req.__rMethod = 'get';
      if (req.skipResource) {
        debug.get('Skipping Resource');
        return next();
      }

      const query = (req.modelQuery || req.model || this.model).findOne();
      const search = { '_id': req.params[`${this.name}Id`] };

      // Only call populate if they provide a populate query.
      const populate = Resource.getParamQuery(req, 'populate');
      if (populate) {
        debug.get(`Populate: ${populate}`);
        query.populate(populate);
      }

      options.hooks.get.before.call(
        this,
        req,
        res,
        search,
        () => {
          query.where(search).lean().exec((err, item) => {
            if (err) return Resource.setResponse(res, { status: 400, error: err }, next);
            if (!item) return Resource.setResponse(res, { status: 404 }, next);

            return options.hooks.get.after.call(
              this,
              req,
              res,
              item,
              () => {
                // Allow them to only return specified fields.
                const select = Resource.getParamQuery(req, 'select');
                if (select) {
                  const newItem = {};
                  // Always include the _id.
                  if (item._id) {
                    newItem._id = item._id;
                  }
                  select.split(' ').map(key => {
                    key = key.trim();
                    if (item.hasOwnProperty(key)) {
                      newItem[key] = item[key];
                    }
                  });
                  item = newItem;
                }
                Resource.setResponse(res, { status: 200, item: item }, next)
              }
            );
          });
        }
      );
    }, Resource.respond, options);
    return this;
  }

  /**
   * Virtual (GET) method. Returns a user-defined projection (typically an aggregate result)
   * derived from this resource
   * The virtual method expects at least the path and the before option params to be set.
   */
  virtual(options) {
    if (!options || !options.path || !options.before) return this;
    const path = options.path;
    options = Resource.getMethodOptions('virtual', options);
    this.methods.push(`virtual/${path}`);
    this._register('get', `${this.route}/virtual/${path}`, (req, res, next) => {
      // Store the internal method for response manipulation.
      req.__rMethod = 'virtual';

      if (req.skipResource) {
        debug.virtual('Skipping Resource');
        return next();
      }
      const query = req.modelQuery || req.model;
      if (!query) return Resource.setResponse(res, { status: 404 }, next);
      query.exec((err, item) => {
        if (err) return Resource.setResponse(res, { status: 400, error: err }, next);
        if (!item) return Resource.setResponse(res, { status: 404 }, next);
        return Resource.setResponse(res, { status: 200, item }, next);
      });
    }, Resource.respond, options);
    return this;
  }

  /**
   * Post (Create) a new item
   */
  post(options) {
    options = Resource.getMethodOptions('post', options);
    this.methods.push('post');
    this._register('post', this.route, (req, res, next) => {
      // Store the internal method for response manipulation.
      req.__rMethod = 'post';

      if (req.skipResource) {
        debug.post('Skipping Resource');
        return next();
      }

      const Model = req.model || this.model;
      const model = new Model(req.body);
      options.hooks.post.before.call(
        this,
        req,
        res,
        req.body,
        () => {
          const writeOptions = req.writeOptions || {};
          model.save(writeOptions, (err, item) => {
            if (err) {
              debug.post(err);
              return Resource.setResponse(res, { status: 400, error: err }, next);
            }

            debug.post(item);
            // Trigger any after hooks before responding.
            return options.hooks.post.after.call(
              this,
              req,
              res,
              item,
              Resource.setResponse.bind(Resource, res, { status: 201, item }, next)
            );
          });
        }
      );
    }, Resource.respond, options);
    return this;
  }

  /**
   * Put (Update) a resource.
   */
  put(options) {
    options = Resource.getMethodOptions('put', options);
    this.methods.push('put');
    this._register('put', `${this.route}/:${this.name}Id`, (req, res, next) => {
      // Store the internal method for response manipulation.
      req.__rMethod = 'put';

      if (req.skipResource) {
        debug.put('Skipping Resource');
        return next();
      }

      // Remove __v field
      const { __v, ...update} = req.body;
      const query = req.modelQuery || req.model || this.model;

      query.findOne({ _id: Resource.ObjectId(req.params[`${this.name}Id`]) }, (err, item) => {
        if (err) {
          debug.put(err);
          return Resource.setResponse(res, { status: 400, error: err }, next);
        }
        if (!item) {
          debug.put(`No ${this.name} found with ${this.name}Id: ${req.params[`${this.name}Id`]}`);
          return Resource.setResponse(res, { status: 404 }, next);
        }

        item.set(update);
        options.hooks.put.before.call(
          this,
          req,
          res,
          item,
          () => {
          const writeOptions = req.writeOptions || {};
          item.save(writeOptions, (err, item) => {
            if (err) {
              debug.put(err);
              return Resource.setResponse(res, { status: 400, error: err }, next);
            }

            return options.hooks.put.after.call(
              this,
              req,
              res,
              item,
              Resource.setResponse.bind(Resource, res, { status: 200, item }, next)
            );
          });
        });
      });
    }, Resource.respond, options);
    return this;
  }

  /**
   * Patch (Partial Update) a resource.
   */
  patch(options) {
    options = Resource.getMethodOptions('patch', options);
    this.methods.push('patch');
    this._register('patch', `${this.route}/:${this.name}Id`, (req, res, next) => {
      // Store the internal method for response manipulation.
      req.__rMethod = 'patch';

      if (req.skipResource) {
        debug.patch('Skipping Resource');
        return next();
      }
      const query = req.modelQuery || req.model || this.model;
      const writeOptions = req.writeOptions || {};
      query.findOne({ '_id': req.params[`${this.name}Id`] }, (err, item) => {
        if (err) return Resource.setResponse(res, { status: 400, error: err }, next);
        if (!item) return Resource.setResponse(res, { status: 404, error: err }, next);

        // Ensure patches is an array
        const patches = [].concat(req.body);
        let patchFail = null;
        try {
          patches.forEach((patch) => {
            if (patch.op === 'test') {
              patchFail = patch;
              const success = jsonpatch.applyOperation(item, patch, true);
              if (!success || !success.test) {
                return Resource.setResponse(res, {
                  status: 412,
                  name: 'Precondition Failed',
                  message: 'A json-patch test op has failed. No changes have been applied to the document',
                  item,
                  patch,
                }, next);
              }
            }
          });
          jsonpatch.applyPatch(item, patches, true);
        }
        catch (err) {
          switch (err.name) {
            // Check whether JSON PATCH error
            case 'TEST_OPERATION_FAILED':
              return Resource.setResponse(res, {
                status: 412,
                name: 'Precondition Failed',
                message: 'A json-patch test op has failed. No changes have been applied to the document',
                item,
                patch: patchFail,
              }, next);
            case 'SEQUENCE_NOT_AN_ARRAY':
            case 'OPERATION_NOT_AN_OBJECT':
            case 'OPERATION_OP_INVALID':
            case 'OPERATION_PATH_INVALID':
            case 'OPERATION_FROM_REQUIRED':
            case 'OPERATION_VALUE_REQUIRED':
            case 'OPERATION_VALUE_CANNOT_CONTAIN_UNDEFINED':
            case 'OPERATION_PATH_CANNOT_ADD':
            case 'OPERATION_PATH_UNRESOLVABLE':
            case 'OPERATION_FROM_UNRESOLVABLE':
            case 'OPERATION_PATH_ILLEGAL_ARRAY_INDEX':
            case 'OPERATION_VALUE_OUT_OF_BOUNDS':
              err.errors = [{
                name: err.name,
                message: err.toString(),
              }];
              return Resource.setResponse(res, {
                status: 400,
                item,
                error: err,
              }, next);
            // Something else than JSON PATCH
            default:
              return Resource.setResponse(res, { status: 400, item, error: err }, next);
          }
        }
        item.save(writeOptions, (err, item) => {
          if (err) return Resource.setResponse(res, { status: 400, error: err }, next);
          return Resource.setResponse(res, { status: 200, item }, next);
        });
      });
    }, Resource.respond, options);
    return this;
  }

  /**
   * Delete a resource.
   */
  delete(options) {
    options = Resource.getMethodOptions('delete', options);
    this.methods.push('delete');
    this._register('delete', `${this.route}/:${this.name}Id`, (req, res, next) => {
      // Store the internal method for response manipulation.
      req.__rMethod = 'delete';

      if (req.skipResource) {
        debug.delete('Skipping Resource');
        return next();
      }

      const query = req.modelQuery || req.model || this.model;
      query.findOne({ '_id': req.params[`${this.name}Id`] }, (err, item) => {
        if (err) {
          debug.delete(err);
          return Resource.setResponse(res, { status: 400, error: err }, next);
        }
        if (!item) {
          debug.delete(`No ${this.name} found with ${this.name}Id: ${req.params[`${this.name}Id`]}`);
          return Resource.setResponse(res, { status: 404, error: err }, next);
        }
        if (req.skipDelete) {
          return Resource.setResponse(res, { status: 204, item, deleted: true }, next);
        }

        options.hooks.delete.before.call(
          this,
          req,
          res,
          item,
          () => {
            const writeOptions = req.writeOptions || {};
            item.remove(writeOptions, (err) => {
              if (err) {
                debug.delete(err);
                return Resource.setResponse(res, { status: 400, error: err }, next);
              }

              debug.delete(item);
              options.hooks.delete.after.call(
                this,
                req,
                res,
                item,
                Resource.setResponse.bind(Resource, res, { status: 204, item, deleted: true }, next)
              );
            });
          }
        );
      });
    }, Resource.respond, options);
    return this;
  }

  /**
   * Returns the swagger definition for this resource.
   */
  swagger(resetCache) {
    resetCache = resetCache || false;
    if (!this.__swagger || resetCache) {
      this.__swagger = require('./Swagger')(this);
    }
    return this.__swagger;
  }
}

// Make sure to create a new instance of the Resource class.
function ResourceFactory(app, route, modelName, model, options) {
  return new Resource(app, route, modelName, model, options);
}
ResourceFactory.Resource = Resource;

module.exports = ResourceFactory;
