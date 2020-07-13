'use strict';

const compose = require('koa-compose');
const Router = require('@koa/router');

const paginate = require('node-paginate-anything');
const jsonpatch = require('fast-json-patch');
const mongodb = require('mongodb');
const moment = require('moment');
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
    this.router = new Router();
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
   * Add a stack processor to be able to execute the middleware independently of ExpressJS.
   * Taken from https://github.com/randymized/composable-middleware/blob/master/lib/composable-middleware.js#L27
   *
   * @param stack
   * @return {function(...[*]=)}
   */
  stackProcessor(stack) {
    return (ctx, done) => {
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
                fn(err, ctx, next);
                break;
              case 2:
                fn(err, next);
                break;
              default:
                throw err;
            }
          }
          else {
            switch (fn.length) {
              case 3:
                fn(ctx, next);
                break;
              case 1:
                fn(next);
                break;
              default:
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
   * @param method, string, GET, POST, PUT, PATCH, DEL
   * @param path, string, url path to the resource
   * @param middlewares, object, contains beforeQuery, afterQuery and select middlewares
   * @param options, object, contains before, after and hook handlers
   */
  _register(method, path, middlewares, options) {
    const { beforeQueryMW, afterQueryMW, selectMW } = middlewares;

    // The fallback error handler.
    const errorMW = async(ctx, next) => {
      try {
        return await next();
    }
      catch (err) {
        console.log('errorrr', err)
        err.status = err.statusCode || err.status || 500;
        return await Resource.respond(ctx);
      }
    };

    // The before middleware.
    const beforeMW = this._generateMiddleware.call(this, options, 'before');

    const routeStack = compose([
      errorMW,
      beforeMW,
      beforeQueryMW,
      options.hooks.get.before.bind(this),
      afterQueryMW,
      options.hooks.get.after.bind(this),
      selectMW,
    ]);

    // Declare the resourcejs object on the app.
    if (!this.app.context.resourcejs) {
      this.app.context.resourcejs = {};
    }

    if (!this.app.context.resourcejs[path]) {
      this.app.context.resourcejs[path] = {};
    }

    // Add a stack processor so this stack can be executed independently of Express.
    // this.app.context.resourcejs[path][method] = this.stackProcessor(routeStack);

    // Apply these callbacks to the application.
    switch (method) {
      case 'get':
        this.router.get(path, routeStack);
        break;
      case 'post':
        this.router.post(path, routeStack);
        break;
      case 'put':
        this.router.put(path, routeStack);
        break;
      case 'patch':
        this.router.patch(path, routeStack);
        break;
      case 'delete':
        this.router.delete(path, routeStack);
        break;
    }
    this.app.use(this.router.routes(), this.router.allowedMethods());
  }

  _generateMiddleware(options, position) {
    let routeStack = [];

    if (options && options[position]) {
      const before = options[position].map((m) => m.bind(this));
      routeStack = [...routeStack, ...before];
    }
    routeStack = routeStack.length ? compose(routeStack) : async(ctx, next) => {
      console.log(`generated ${position} MW`)
      return await next();
    };
    return routeStack;
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
  static async respond(ctx) {
    console.log('test4 respond')
    if (ctx.headerSent) {
      debug.respond('Skipping');
      return;
    }

    if (ctx.state.resource) {
      switch (ctx.state.resource.status) {
        case 404:
          ctx.status = 404;
          ctx.body = {
            status: 404,
            errors: ['Resource not found'],
          };
          break;
        case 400:
        case 500:
          for (const property in ctx.state.resource.error.errors) {
            // eslint-disable-next-line max-depth
            if (Object.prototype.hasOwnProperty.call(ctx.state.resource.error.errors, property)) {
              const error = ctx.state.resource.error.errors[property];
              const { path, name, message } = error;
              ctx.state.resource.error.errors[property] = { path, name, message };
            }
          }
          ctx.status = ctx.state.resource.status;
          ctx.body = {
            status: ctx.state.resource.status,
            message: ctx.state.resource.error.message,
            errors: ctx.state.resource.error.errors,
          };
          break;
        case 204:
          // Convert 204 into 200, to preserve the empty result set.
          // Update the empty response body based on request method type.
          debug.respond(`204 -> ${ctx.state.__rMethod}`);
          switch (ctx.state.__rMethod) {
            case 'index':
              ctx.status = 200;
              ctx.body = [];
              break;
            default:
              ctx.status = 200;
              ctx.body = {};
              break;
          }
          break;
        default:
          ctx.status = ctx.state.resource.status;
          ctx.body = ctx.state.resource.item;
          break;
      }
    }
    console.log(ctx.state.resource, ctx.status, ctx.body)
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
    res.state.resource = resource;
    // next();
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
    console.log(options.before?.toString())
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
        utils.get(options, path, async(ctx, next) => {
          console.log(`${type} hook`)
          return await next();
        })
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
  static getParamQuery(ctx, name) {
    if (!Object.prototype.hasOwnProperty.call(ctx.query, name)) {
      switch (name) {
        case 'populate':
          return '';
        default:
          return null;
      }
    }

    if (name === 'populate' && utils.isObjectLike(ctx.query[name])) {
      return ctx.query[name];
    }
    else {
      const query = ( Array.isArray(ctx.query[name]) ? ctx.query[name].join(',') : ctx.query[name] );
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
  getFindQuery(ctx, options) {
    const findQuery = {};
    options = options || this.options;

    // Get the filters and omit the limit, skip, select, sort and populate.
    const { limit, skip, select, sort, populate, ...filters } = ctx.query;

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
            findQuery[filter.name] = regex;
          }
          return;
        } // See if there is a selector.
        else if (filter.selector) {
          // Init the filter.
          if (!Object.prototype.hasOwnProperty.call(findQuery, filter.name)) {
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
            value = value.map((item) => Resource.getQueryValue(filter.name, item, param, options, filter.selector));
          }
          else {
            // Set the selector for this filter name.
            value = Resource.getQueryValue(filter.name, value, param, options, filter.selector);
          }

          findQuery[filter.name][`$${filter.selector}`] = value;
          return;
        }
        else {
          // Set the find query to this value.
          value = Resource.getQueryValue(filter.name, value, param, options, filter.selector);
          findQuery[filter.name] = value;
          return;
        }
      }

      if (!options.queryFilter) {
        // Set the find query to this value.
        findQuery[filter.name] = value;
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
    this._register('get', this.route, (ctx, next) => {
      // Store the internal method for response manipulation.
      ctx.__rMethod = 'index';

      // Allow before handlers the ability to disable resource CRUD.
      if (ctx.skipResource) {
        debug.index('Skipping Resource');
        return next();
      }

      // Get the find query.
      const findQuery = this.getFindQuery(ctx);

      // Get the query object.
      const countQuery = ctx.countQuery || ctx.modelQuery || ctx.model || this.model;
      const query = ctx.modelQuery || ctx.model || this.model;

      // First get the total count.
      this.countQuery(countQuery.find(findQuery), query.pipeline).countDocuments((err, count) => {
        if (err) {
          debug.index(err);
          return Resource.setResponse(ctx, { status: 400, error: err }, next);
        }

        // Get the default limit.
        const defaults = { limit: 10, skip: 0 };
        let { limit, skip } = ctx.query;
        limit = parseInt(limit, 10);
        limit = (isNaN(limit) || (limit < 0)) ? defaults.limit : limit;
        skip = parseInt(skip, 10);
        skip = (isNaN(skip) || (skip < 0)) ? defaults.skip : skip;
        const reqQuery = { limit, skip };

        // If a skip is provided, then set the range headers.
        if (reqQuery.skip && !ctx.headers.range) {
          ctx.headers['range-unit'] = 'items';
          ctx.headers.range = `${reqQuery.skip}-${reqQuery.skip + (reqQuery.limit - 1)}`;
        }

        // Get the page range.
        const pageRange = paginate(ctx, count, reqQuery.limit) || {
          limit: reqQuery.limit,
          skip: reqQuery.skip,
        };

        // Make sure that if there is a range provided in the headers, it takes precedence.
        if (ctx.headers.range) {
          reqQuery.limit = pageRange.limit;
          reqQuery.skip = pageRange.skip;
        }

        // Next get the items within the index.
        const queryExec = query
          .find(findQuery)
          .limit(reqQuery.limit)
          .skip(reqQuery.skip)
          .select(Resource.getParamQuery(ctx, 'select'))
          .sort(Resource.getParamQuery(ctx, 'sort'));

        // Only call populate if they provide a populate query.
        const populate = Resource.getParamQuery(ctx, 'populate');
        if (populate) {
          debug.index(`Populate: ${populate}`);
          queryExec.populate(populate);
        }

        options.hooks.index.before.call(
          this,
          ctx,
          findQuery,
          () => this.indexQuery(queryExec, query.pipeline).exec((err, items) => {
            if (err) {
              debug.index(err);
              debug.index(err.name);

              if (err.name === 'CastError' && populate) {
                err.message = `Cannot populate "${populate}" as it is not a reference in this resource`;
                debug.index(err.message);
              }

              return Resource.setResponse(ctx, { status: 400, error: err }, next);
            }

            debug.index(items);
            options.hooks.index.after.call(
              this,
              ctx,
              items,
              Resource.setResponse.bind(Resource, ctx, { status: ctx.statusCode, item: items }, next)
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
    const afterMW = compose([this._generateMiddleware.call(this, options, 'after'), Resource.respond]);
    const beforeQueryMW = async(ctx, next) => { // Callback
        console.log('test1')
        // Store the internal method for response manipulation.
      ctx.state.__rMethod = 'get';
      if (ctx.state.skipResource) {
        console.log('test1 skip', ctx.state.skipResource)
          debug.get('Skipping Resource');
        return await afterMW(ctx);
        }
      console.log('test1 model')
      ctx.state.modelQuery = (ctx.state.modelQuery || ctx.state.model || this.model).findOne();
      ctx.state.search = { '_id': ctx.params[`${this.name}Id`] };
      console.log('test1 populate', ctx.state.search, ctx.params)
        // Only call populate if they provide a populate query.
        const populate = Resource.getParamQuery(ctx, 'populate');
        if (populate) {
          debug.get(`Populate: ${populate}`);
          ctx.modelQuery.populate(populate);
        }
      console.log('test1 next')
        return await next();
    };
    const afterQueryMW = async(ctx, next) => { // Callback
        console.log('test2')
      ctx.state.item = await ctx.state.modelQuery.where(ctx.state.search).lean().exec();
      if (!ctx.state.item) {
        console.log('test2 no item')
          Resource.setResponse(ctx, { status: 404 }, next);
        }
        return await next();
    };
    const selectMW = async(ctx, next) => {
        console.log('test3')
        // Allow them to only return specified fields.
        const select = Resource.getParamQuery(ctx, 'select');
        if (select) {
        console.log('test3 select')
          const newItem = {};
          // Always include the _id.
        if (ctx.state.item._id) {
            newItem._id = ctx.item._id;
          }
          select.split(' ').map(key => {
            key = key.trim();
          if (Object.prototype.hasOwnProperty.call(ctx.state.item, key)) {
              newItem[key] = ctx.item[key];
            }
          });
        ctx.state.item = newItem;
        }
      console.log('test3 response')
      Resource.setResponse(ctx, { status: 200, item: ctx.state.item }, next);
        return await next();
    };
    const middlewares = {
      beforeQueryMW,
      afterQueryMW,
      selectMW,
    };
    this._register('get',`${this.route}/:${this.name}Id`, middlewares, options);
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
    this._register('get', `${this.route}/virtual/${path}`, (ctx, next) => {
      // Store the internal method for response manipulation.
      ctx.__rMethod = 'virtual';

      if (ctx.skipResource) {
        debug.virtual('Skipping Resource');
        return next();
      }
      const query = ctx.modelQuery || ctx.model;
      if (!query) return Resource.setResponse(ctx, { status: 404 }, next);
      query.exec((err, item) => {
        if (err) return Resource.setResponse(ctx, { status: 400, error: err }, next);
        if (!item) return Resource.setResponse(ctx, { status: 404 }, next);
        return Resource.setResponse(ctx, { status: 200, item }, next);
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
    this._register('post', this.route, (ctx, next) => {
      // Store the internal method for response manipulation.
      ctx.__rMethod = 'post';

      if (ctx.skipResource) {
        debug.post('Skipping Resource');
        return next();
      }

      const Model = ctx.model || this.model;
      const model = new Model(ctx.request.body);
      options.hooks.post.before.call(
        this,
        ctx,
        ctx.request.body,
        () => {
          const writeOptions = ctx.writeOptions || {};
          model.save(writeOptions, (err, item) => {
            if (err) {
              debug.post(err);
              return Resource.setResponse(ctx, { status: 400, error: err }, next);
            }

            debug.post(item);
            // Trigger any after hooks before responding.
            return options.hooks.post.after.call(
              this,
              ctx,
              item,
              Resource.setResponse.bind(Resource, ctx, { status: 201, item }, next)
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
    this._register('put', `${this.route}/:${this.name}Id`, (ctx, next) => {
      // Store the internal method for response manipulation.
      ctx.__rMethod = 'put';

      if (ctx.skipResource) {
        debug.put('Skipping Resource');
        return next();
      }

      // Remove __v field
      const { __v, ...update } = ctx.request.body;
      const query = ctx.modelQuery || ctx.model || this.model;

      query.findOne({ _id: ctx.params[`${this.name}Id`] }, (err, item) => {
        if (err) {
          debug.put(err);
          return Resource.setResponse(ctx, { status: 400, error: err }, next);
        }
        if (!item) {
          debug.put(`No ${this.name} found with ${this.name}Id: ${ctx.params[`${this.name}Id`]}`);
          return Resource.setResponse(ctx, { status: 404 }, next);
        }

        item.set(update);
        options.hooks.put.before.call(
          this,
          ctx,
          item,
          () => {
          const writeOptions = ctx.writeOptions || {};
          item.save(writeOptions, (err, item) => {
            if (err) {
              debug.put(err);
              return Resource.setResponse(ctx, { status: 400, error: err }, next);
            }

            return options.hooks.put.after.call(
              this,
              ctx,
              item,
              Resource.setResponse.bind(Resource, ctx, { status: 200, item }, next)
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
    this._register('patch', `${this.route}/:${this.name}Id`, (ctx, next) => {
      // Store the internal method for response manipulation.
      ctx.__rMethod = 'patch';

      if (ctx.skipResource) {
        debug.patch('Skipping Resource');
        return next();
      }
      const query = ctx.modelQuery || ctx.model || this.model;
      const writeOptions = ctx.writeOptions || {};
      query.findOne({ '_id': ctx.params[`${this.name}Id`] }, (err, item) => {
        if (err) return Resource.setResponse(ctx, { status: 400, error: err }, next);
        if (!item) return Resource.setResponse(ctx, { status: 404, error: err }, next);

        // Ensure patches is an array
        const patches = [].concat(ctx.request.body);
        let patchFail = null;
        try {
          patches.forEach((patch) => {
            if (patch.op === 'test') {
              patchFail = patch;
              const success = jsonpatch.applyOperation(item, patch, true);
              if (!success || !success.test) {
                return Resource.setResponse(ctx, {
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
              return Resource.setResponse(ctx, {
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
              return Resource.setResponse(ctx, {
                status: 400,
                item,
                error: err,
              }, next);
            // Something else than JSON PATCH
            default:
              return Resource.setResponse(ctx, { status: 400, item, error: err }, next);
          }
        }
        item.save(writeOptions, (err, item) => {
          if (err) return Resource.setResponse(ctx, { status: 400, error: err }, next);
          return Resource.setResponse(ctx, { status: 200, item }, next);
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
    this._register('delete', `${this.route}/:${this.name}Id`, (ctx, next) => {
      // Store the internal method for response manipulation.
      ctx.__rMethod = 'delete';

      if (ctx.skipResource) {
        debug.delete('Skipping Resource');
        return next();
      }

      const query = ctx.modelQuery || ctx.model || this.model;
      query.findOne({ '_id': ctx.params[`${this.name}Id`] }, (err, item) => {
        if (err) {
          debug.delete(err);
          return Resource.setResponse(ctx, { status: 400, error: err }, next);
        }
        if (!item) {
          debug.delete(`No ${this.name} found with ${this.name}Id: ${ctx.params[`${this.name}Id`]}`);
          return Resource.setResponse(ctx, { status: 404, error: err }, next);
        }
        if (ctx.skipDelete) {
          return Resource.setResponse(ctx, { status: 204, item, deleted: true }, next);
        }

        options.hooks.delete.before.call(
          this,
          ctx,
          item,
          () => {
            const writeOptions = ctx.writeOptions || {};
            item.remove(writeOptions, (err) => {
              if (err) {
                debug.delete(err);
                return Resource.setResponse(ctx, { status: 400, error: err }, next);
              }

              debug.delete(item);
              options.hooks.delete.after.call(
                this,
                ctx,
                item,
                Resource.setResponse.bind(Resource, ctx, { status: 204, item, deleted: true }, next)
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
