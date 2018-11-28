'use strict';

const _ = require('lodash');
const paginate = require('node-paginate-anything');
const jsonpatch = require('fast-json-patch');
const middleware = require('composable-middleware');
const mongodb = require('mongodb');
const moment = require('moment');
const debug = {
  query: require('debug')('resourcejs:query'),
  index: require('debug')('resourcejs:index'),
  get: require('debug')('resourcejs:get'),
  put: require('debug')('resourcejs:put'),
  post: require('debug')('resourcejs:post'),
  delete: require('debug')('resourcejs:delete'),
  respond: require('debug')('resourcejs:respond'),
};

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
   * Register a new callback but add before and after options to the middleware.
   *
   * @param method
   * @param path
   * @param callback
   * @param last
   * @param options
   */
  _register(method, path, callback, last, options) {
    const mw = middleware();

    // The before middleware.
    if (options && options.before) {
      const before = [].concat(options.before);
      before.forEach((m) => mw.use(m.bind(this)));
    }

    mw.use(callback.bind(this));

    // The after middleware.
    if (options && options.after) {
      const after = [].concat(options.after);
      after.forEach((m) => mw.use(m.bind(this)));
    }

    mw.use(last.bind(this));

    // Add a fallback error handler.
    mw.use((err, req, res, next) => {
      if (err) {
        res.status(400).json({
          status: 400,
          message: err.message || err,
        });
      }
      else {
        return next();
      }
    });

    // Declare the resourcejs object on the app.
    if (!this.app.resourcejs) {
      this.app.resourcejs = {};
    }

    if (!this.app.resourcejs[path]) {
      this.app.resourcejs[path] = {};
    }

    // Add these methods to resourcejs object in the app.
    this.app.resourcejs[path][method] = mw;

    // Apply these callbacks to the application.
    this.app[method](path, mw);
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
          res.status(res.resource.status).json({
            status: res.resource.status,
            message: res.resource.error.message,
            errors: _.mapValues(res.resource.error.errors, (error) => _.pick(error, [
              'path',
              'name',
              'message',
            ])),
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
    const beforeHandlers = options.before || [];
    const beforeMethodHandlers = options[`before${method}`] || [];
    methodOptions.before = _.concat(beforeHandlers, beforeMethodHandlers);

    const afterHandlers = options.after || [];
    const afterMethodHandlers = options[`after${method}`] || [];
    methodOptions.after = _.concat(afterHandlers, afterMethodHandlers);

    // Expose mongoose hooks for each method.
    ['before', 'after'].forEach((type) => {
      const path = `hooks.${method.toString().toLowerCase()}.${type}`;

      _.set(
        methodOptions,
        path,
        _.get(options, path, (req, res, item, next) => next())
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
    if (!req.query.hasOwnProperty(name)) {
      switch (name) {
        case 'populate':
          return '';
        default:
          return null;
      }
    }

    if (name === 'populate' && _.isObjectLike(req.query[name])) {
      return req.query[name];
    }
    else {
      return _
      .chain(req.query[name])
      .words(/[^, ]+/g)
      .uniq()
      .join(' ')
      .value();
    }
  }

  static getQueryValue(name, value, param, options) {
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
      (mongodb.ObjectID.isValid(value))
    ) {
      try {
        value = new mongodb.ObjectID(value);
      }
      catch (err) {
        console.warn(`Invalid ObjectID: ${value}`);
      }
    }

    return value;
  }

  /**
   * Get the find query for the index.
   *
   * @param req
   * @returns {Object}
   */
  getFindQuery(req, options) {
    const findQuery = {};
    options = options || this.options;

    // Get the filters and omit the limit, skip, select, sort and populate.
    const filters = _.omit(req.query, 'limit', 'skip', 'select', 'sort', 'populate');

    // Iterate through each filter.
    _.forOwn(filters, (value, name) => {
      // Get the filter object.
      const filter = _.zipObject(['name', 'selector'], name.split('__'));

      // See if this parameter is defined in our model.
      const param = this.model.schema.paths[filter.name.split('.')[0]];
      if (param) {
        // See if there is a selector.
        if (filter.selector) {
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
              findQuery[filter.name] = regex;
            }
            return;
          }
          else {
            // Init the filter.
            if (!findQuery.hasOwnProperty(filter.name)) {
              findQuery[filter.name] = {};
            }

            if (filter.selector === 'exists') {
              value = ((value === 'true') || (value === '1')) ? true : value;
              value = ((value === 'false') || (value === '0')) ? false : value;
              value = !!value;
            }
            // Special case for in filter with multiple values.
            else if (['in', 'nin'].includes(filter.selector)) {
              value = Array.isArray(value) ? value : value.split(',');
              value = value.map((item) => Resource.getQueryValue(filter.name, item, param, options));
            }
            else {
              // Set the selector for this filter name.
              value = Resource.getQueryValue(filter.name, value, param, options);
            }

            findQuery[filter.name][`$${filter.selector}`] = value;
            return;
          }
        }
        else {
          // Set the find query to this value.
          value = Resource.getQueryValue(filter.name, value, param, options);
          findQuery[filter.name] = value;
          return;
        }
      }

      // Set the find query to this value.
      findQuery[filter.name] = value;
    });

    // Return the findQuery.
    return findQuery;
  }

  countQuery(query, pipeline) {
    // We cannot use aggregation if mongoose special options are used... like populate.
    if (!_.isEmpty(query._mongooseOptions) || !pipeline) {
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
    if (!_.isEmpty(query._mongooseOptions) || !pipeline) {
      return query.lean();
    }

    const stages = [
      { $match: query.getQuery() },
      ...pipeline,
    ];

    if (_.has(query, 'options.sort') && !_.isEmpty(query.options.sort)) {
      stages.push({ $sort: query.options.sort });
    }
    if (_.has(query, 'options.skip')) {
      stages.push({ $skip: query.options.skip });
    }
    if (_.has(query, 'options.limit')) {
      stages.push({ $limit: query.options.limit });
    }
    if (!_.isEmpty(query._fields)) {
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
        return next();
      }

      // Get the find query.
      const findQuery = this.getFindQuery(req);

      // Get the query object.
      const countQuery = req.countQuery || req.modelQuery || req.model || this.model;
      const query = req.modelQuery || req.model || this.model;

      // First get the total count.
      this.countQuery(countQuery.find(findQuery), query.pipeline).countDocuments((err, count) => {
        if (err) {
          debug.index(err);
          return Resource.setResponse(res, { status: 400, error: err }, next);
        }

        // Get the default limit.
        const defaults = { limit: 10, skip: 0 };
        const reqQuery = _
          .chain(req.query)
          .pick('limit', 'skip')
          .defaults(defaults)
          .mapValues((value, key) => {
            value = parseInt(value, 10);
            return (isNaN(value) || (value < 0)) ? defaults[key] : value;
          })
          .value();

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
              Resource.setResponse.bind(Resource, res, { status: 200, item: item }, next)
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
   */
  virtual(options) {
    options = Resource.getMethodOptions('virtual', options);
    this.methods.push('virtual');
    const path = (options.path === undefined) ? this.path : options.path;
    this._register('get', `${this.route}/virtual/${path}`, (req, res, next) => {
      // Store the internal method for response manipulation.
      req.__rMethod = 'virtual';

      if (req.skipResource) {
        return next();
      }
      const query = req.modelQuery || req.model;
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
      const update = _.omit(req.body, '__v');
      const query = req.modelQuery || req.model || this.model;

      query.findOne({ _id: req.params[`${this.name}Id`] }, (err, item) => {
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
        return next();
      }
      const query = req.modelQuery || req.model || this.model;
      const writeOptions = req.writeOptions || {};
      query.findOne({ '_id': req.params[`${this.name}Id`] }, (err, item) => {
        if (err) return Resource.setResponse(res, { status: 400, error: err }, next);
        if (!item) return Resource.setResponse(res, { status: 404, error: err }, next);
        const patches = req.body;
        let patchFail = null;
        try {
          patches.forEach((patch) => {
            if (patch.op === 'test') {
              patchFail = patch;
              const success = jsonpatch.applyPatch(item, [].concat(patch), true);
              if (!success || !success.length) {
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
          if (err && err.name === 'TEST_OPERATION_FAILED') {
            return Resource.setResponse(res, {
              status: 412,
              name: 'Precondition Failed',
              message: 'A json-patch test op has failed. No changes have been applied to the document',
              item,
              patch: patchFail,
            }, next);
          }

          if (err) return Resource.setResponse(res, { status: 400, item, error: err }, next);
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
        debug.delete('SKipping Resource');
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
