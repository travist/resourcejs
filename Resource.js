var _ = require('lodash');
var mongoose = require('mongoose');
var paginate = require('node-paginate-anything');
var jsonpatch = require('fast-json-patch');
var middleware = require( 'composable-middleware' );


module.exports = function(app, route, modelName, model) {

  // Create the name of the resource.
  var name = modelName.toLowerCase();

  // Return the object that defines this resource.
  return {

    /**
     * The model for this resource.
     */
    model: model,

    /**
     * The name of the model.
     */
    modelName: modelName,

    /**
     * The name of this resource.
     */
    name: name,

    /**
     * The route for this model.
     */
    route: route + '/' + name,

    /**
     * The methods that are exposed to this resource.
     */
    methods: [],

    /**
     * The swagger cache.
     */
    __swagger: null,

    /**
     * Register a new callback but add before and after options to the middleware.
     *
     * @param app
     * @param method
     * @param path
     * @param callback
     * @param last
     * @param options
     */
    register: function(app, method, path, callback, last, options) {
      var mw = middleware();

      // The before middleware.
      if (options && options.before) {
        var before = [].concat(options.before);
        for (var len = before.length, i=0; i<len; ++i) {
          mw.use(before[i].bind(this));
        }
      }
      mw.use(callback.bind(this));

      // The after middleware.
      if (options && options.after) {
        var after = [].concat(options.after);
        for (var len = after.length, i=0; i<len; ++i) {
          mw.use(after[i].bind(this));
        }
      }
      mw.use(last.bind(this));

      // Declare the resourcejs object on the app.
      if (!app.resourcejs) {
        app.resourcejs = {};
      }

      if (!app.resourcejs[path]) {
        app.resourcejs[path] = {};
      }

      // Add these methods to resourcejs object in the app.
      app.resourcejs[path][method] = mw;

      // Apply these callbacks to the application.
      app[method](path, mw);
    },

    /**
     * Sets the different responses and calls the next middleware for
     * execution.
     *
     * @param res
     *   The response to send to the client.
     * @param next
     *   The next middleware
     */
    respond: function(req, res, next) {
      if (req.noResponse || res.headerSent || res.headersSent) { return next(); }
      if (res.resource) {
        switch (res.resource.status) {
          case 400:
            res.status(400).json({
              status: 400,
              message: res.resource.error.message,
              errors: _.mapValues(res.resource.error.errors, function(error) {
                return _.pick(error, 'path', 'name', 'message');
              })
            });
            break;
          case 404:
            res.status(404).json({
              status: 404,
              errors: ['Resource not found']
            });
            break;
          case 500:
            res.status(500).json({
              status: 500,
              message: res.resource.error.message,
              errors: _.mapValues(res.resource.error.errors, function(error) {
                return _.pick(error, 'path', 'name', 'message');
              })
            });
            break;
          default:
            res.status(res.resource.status).json(res.resource.item);
            break;
        }
      }

      next();
    },

    /**
     * Sets the response that needs to be made and calls the next middleware for
     * execution.
     *
     * @param res
     * @param resource
     * @param next
     */
    setResponse: function(res, resource, next) {
      res.resource = resource;
      next();
    },

    /**
     * Returns the method options for a specific method to be executed.
     * @param method
     * @param options
     * @returns {{}}
     */
    getMethodOptions: function(method, options) {
      if (!options) return {};

      // Uppercase the method.
      method = method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
      var methodOptions = {};

      // Find all of the options that may have been passed to the rest method.
      if (options.before) {
        methodOptions.before = options.before;
      }
      else if (options.hasOwnProperty('before' + method)) {
        methodOptions.before = options['before' + method];
      }

      if (options.after) {
        methodOptions.after = options.after;
      }
      else if (options.hasOwnProperty('after' + method)) {
        methodOptions.after = options['after' + method];
      }

      // Return the options for this method.
      return methodOptions;
    },

    /**
     * Register the whole REST api for this resource.
     *
     * @param options
     * @returns {*|null|HttpPromise}
     */
    rest: function(options) {
      return this
        .index(this.getMethodOptions('index', options))
        .get(this.getMethodOptions('get', options))
        .virtual(this.getMethodOptions('virtual', options))
        .put(this.getMethodOptions('put', options))
        .patch(this.getMethodOptions('patch', options))
        .post(this.getMethodOptions('post', options))
        .delete(this.getMethodOptions('delete', options));
    },

    /**
     * Returns a query parameters fields.
     *
     * @param req
     * @param name
     * @returns {*}
     */
    getParamQuery: function(req, name) {
      if (!req.query.hasOwnProperty(name)) {
        return null;
      }
      return _.words(req.query[name], /[^, ]+/g).join(' ');
    },

    /**
     * Get the find query for the index.
     *
     * @param req
     * @returns {Object}
     */
    getFindQuery: function(req) {
      var findQuery = {};

      // Get the filters and omit the limit, skip, select, and sort.
      var filters = _.omit(req.query, 'limit', 'skip', 'select', 'sort');

      // Iterate through each filter.
      _.each(filters, function(value, name) {

        // Get the filter object.
        var filter = _.zipObject(['name', 'selector'], _.words(name, /[^,_ ]+/g));

        // See if this parameter is defined in our model.
        var param = this.model.schema.paths[filter.name];
        if (param) {

          // See if there is a selector.
          if (filter.selector) {

            // See if this selector is a regular expression.
            if (filter.selector == 'regex') {

              // Set the regular expression for the filter.
              var parts = value.match(/\/?([^/]+)\/?([^/]+)?/);
              findQuery[filter.name] = new RegExp(parts[1], parts[2]);
              return;
            }
            else {

              // Init the filter.
              if (!findQuery.hasOwnProperty(filter.name)) {
                findQuery[filter.name] = {};
              }

              // Set the selector for this filter name.
              value = (param.instance === 'Number') ? parseInt(value, 10) : value;
              findQuery[filter.name]['$' + filter.selector] = value;
              return;
            }
          }
          else {

            // Set the find query to this value.
            value = (param.instance === 'Number') ? parseInt(value, 10) : value;
            findQuery[filter.name] = value;
            return;
          }
        }

        // Set the find query to this value.
        findQuery[filter.name] = value;
      }.bind(this));

      // Return the findQuery.
      return findQuery;
    },

    /**
     * The index for a resource.
     *
     * @param options
     */
    index: function(options) {
      this.methods.push('index');
      this.register(app, 'get', this.route, function(req, res, next) {

        // Allow before handlers the ability to disable resource CRUD.
        if (req.skipResource) { return next(); }

        // Get the find query.
        var findQuery = this.getFindQuery(req);

        // Get the query object.
        var countQuery = req.countQuery || req.modelQuery || this.model;
        var query = req.modelQuery || this.model;

        // First get the total count.
        countQuery.find(findQuery).count(function(err, count) {
          if (err) return this.setResponse(res, {status: 500, error: err}, next);

          // Get the default limit.
          var defaultLimit = req.query.limit || 10;
          defaultLimit = parseInt(defaultLimit, 10);

          // If a skip is provided, then set the range headers.
          if (req.query.skip && !req.headers.range) {
            var defaultSkip = parseInt(req.query.skip, 10);
            req.headers['range-unit'] = 'items';
            req.headers.range = defaultSkip + '-' + (defaultSkip + (defaultLimit - 1));
          }

          // Get the page range.
          var pageRange = paginate(req, res, count, defaultLimit) || {
            limit: 10,
            skip: 0
          };

          // Next get the items within the index.
          query
            .find(findQuery)
            .limit(req.query.hasOwnProperty('limit') ? req.query.limit : pageRange.limit)
            .skip(req.query.hasOwnProperty('skip') ? req.query.skip : pageRange.skip)
            .select(this.getParamQuery(req, 'select'))
            .sort(this.getParamQuery(req, 'sort'))
            .exec(function(err, items) {
              if (err) return this.setResponse(res, {status: 500, error: err}, next);
              return this.setResponse(res, {status: res.statusCode, item: items}, next);
            }.bind(this));
        }.bind(this));
      }, this.respond.bind(this), options);
      return this;
    },

    /**
     * Register the GET method for this resource.
     */
    get: function(options) {
      this.methods.push('get');
      this.register(app, 'get', this.route + '/:' + this.name + 'Id', function(req, res, next) {
        if (req.skipResource) {
          return next();
        }

        var query = req.modelQuery || this.model;
        query.findOne({'_id': req.params[this.name + 'Id']}, function(err, item) {
          if (err) return this.setResponse(res, {status: 500, error: err}, next);
          if (!item) return this.setResponse(res, {status: 404}, next);

          return this.setResponse(res, {status: 200, item: item}, next);
        }.bind(this));
      }, this.respond.bind(this), options);
      return this;
    },


    /**
     * Virtual (GET) method. Returns a user-defined projection (typically an aggregate result)
     * derived from this resource
     */
    virtual: function(options) {
      this.methods.push('virtual');
      var path = (options.path === undefined) ? this.path : options.path;
      this.register(app, 'get', this.route + '/virtual/' + path, function(req, res, next) {
        if (req.skipResource) { return next(); }
        var query = req.modelQuery;
        query.exec(function(err, item) {
          if (err) return this.setResponse(res, {status: 500, error: err}, next);
          if (!item) return this.setResponse(res, {status: 404}, next);
          return this.setResponse(res, {status: 200, item: item}, next);
        }.bind(this));
      }, this.respond.bind(this), options);
      return this;
    },

    /**
     * Post (Create) a new item
     */
    post: function(options) {
      this.methods.push('post');
      this.register(app, 'post', this.route, function(req, res, next) {
        if (req.skipResource) { return next(); }
        this.model.create(req.body, function(err, item) {
          if (err) return this.setResponse(res, {status: 400, error: err}, next);
          return this.setResponse(res, {status: 201, item: item}, next);
        }.bind(this));
      }, this.respond.bind(this), options);
      return this;
    },

    /**
     * Put (Update) a resource.
     */
    put: function(options) {
      this.methods.push('put');
      this.register(app, 'put', this.route + '/:' + this.name + 'Id', function(req, res, next) {
        if (req.skipResource) { return next(); }
        var query = req.modelQuery || this.model;
        query.findOne({'_id': req.params[this.name + 'Id']}, function(err, item) {
          if (err) return this.setResponse(res, {status: 500, error: err}, next);
          if (!item) return this.setResponse(res, {status: 404}, next);
          if (req.body.hasOwnProperty('__v')) { delete req.body.__v; }
          item.set(req.body);
          item.save(function (err, item) {
            if (err) return this.setResponse(res, {status: 400, error: err}, next);
            return this.setResponse(res, {status: 200, item: item}, next);
          }.bind(this));
        }.bind(this));
      }, this.respond.bind(this), options);
      return this;
    },

    /**
     * Patch (Partial Update) a resource.
     */
    patch: function(options) {
      this.methods.push('patch');
      this.register(app, 'patch', this.route + '/:' + this.name + 'Id', function(req, res, next) {
        if (req.skipResource) { return next(); }
        var query = req.modelQuery || this.model;
        query.findOne({'_id': req.params[this.name + 'Id']}, function(err, item) {
          if (err) return this.setResponse(res, {status: 500, error: err}, next);
          if (!item) return this.setResponse(res, {status: 404, error: err}, next);
          var patches = req.body
          try {
            for (var len = patches.length, i=0; i<len; ++i) {
              var patch = patches[i];
              if(patch.op=='test'){
                var success = jsonpatch.apply(item, [].concat(patch), true);
                if(!success){
                  return this.setResponse(res, {
                    status: 412,
                    name: 'Precondition Failed',
                    message: 'A json-patch test op has failed. No changes have been applied to the document',
                    item:item,
                    patch:patch,
                  }, next);
                }
              }
            }
            jsonpatch.apply(item, patches, true)
          } catch(err) {
            if (err) return this.setResponse(res, {status: 500, item: item, error: err}, next);
          }
          item.save(function (err, item) {
            if (err) return this.setResponse(res, {status: 400, error: err}, next);
            return this.setResponse(res, {status: 200, item: item}, next);
          }.bind(this));
        }.bind(this));
      }, this.respond.bind(this), options);
      return this;
    },

    /**
     * Delete a resource.
     */
    delete: function(options) {
      this.methods.push('delete');
      this.register(app, 'delete', this.route + '/:' + this.name + 'Id', function(req, res, next) {
        if (req.skipResource) { return next(); }
        var query = req.modelQuery || this.model;
        query.findOne({'_id': req.params[this.name + 'Id']}, function(err, item) {
          if (err) return this.setResponse(res, {status: 500, error: err}, next);
          if (!item) return this.setResponse(res, {status: 404, error: err}, next);
          item.remove(function (err, item) {
            if (err) return this.setResponse(res, {status: 400, error: err}, next);
            return this.setResponse(res, {status: 204, item: item, deleted: true}, next);
          }.bind(this));
        }.bind(this));
      }, this.respond.bind(this), options);
      return this;
    },

    /**
     * Returns the swagger definition for this resource.
     */
    swagger: function() {
      if (!this.__swagger) {
        this.__swagger = require('./Swagger')(this);
      }
      return this.__swagger;
    }
  };
};
