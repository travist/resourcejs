var _ = require('lodash');
var mongoose = require('mongoose');
var paginate = require('node-paginate-anything');

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
     * Register a new callback but add before and after options to the
     * middleware.
     *
     * @param path
     * @param callback
     * @param options
     * @returns {*[]}
     */
    register: function(path, callback, options) {
      var args = [path];
      if (options && options.before) {
        args.push(options.before.bind(this));
      }
      args.push(callback.bind(this));
      if (options && options.after) {
        args.push(options.after.bind(this));
      }
      return args;
    },

    /**
     * The different responses.
     * @param status
     * @returns {{status: number, error: string}}
     */
    respond: function(res, status, err) {
      switch (status) {
        case 400:
          res.status(400).json({
            status: 400,
            error: 'Bad Request: ' + err
          });
        case 404:
          res.status(404).json({
            status: 404,
            error: 'Resource not found'
          });
        case 500:
          res.status(500).json({
            status: 500,
            error: 'An error has occured' + (err ? ': ' + err : '')
          });
      }
    },

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
        .put(this.getMethodOptions('put', options))
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
            }
            else {

              // Init the filter.
              if (!findQuery.hasOwnProperty(filter.name)) {
                findQuery[filter.name] = {};
              }

              // Set the selector for this filter name.
              value = (param.instance === 'Number') ? parseInt(value, 10) : value;
              findQuery[filter.name]['$' + filter.selector] = value;
            }
          }
          else {

            // Set the find query to this value.
            value = (param.instance === 'Number') ? parseInt(value, 10) : value;
            findQuery[filter.name] = value;
          }
        }
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
      app.get.apply(app, this.register(this.route, function(req, res, next) {

        // Get the find query.
        var findQuery = this.getFindQuery(req);

        // Get the query object.
        var query = req.modelQuery || this.model;

        // First get the total count.
        query.find(findQuery).count(function(err, count) {
          if (err) return this.respond(res, 500, err);

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
              if (err) return this.respond(res, 500, err);
              res.status(res.statusCode).json(items);
            }.bind(this));
        }.bind(this));
      }, options));
      return this;
    },

    /**
     * Register the GET method for this resource.
     */
    get: function(options) {
      this.methods.push('get');
      app.get.apply(app, this.register(this.route + '/:' + this.name + 'Id', function(req, res, next) {
        var query = req.modelQuery || this.model;
        query.findOne({"_id": req.params[this.name + 'Id']}, function(err, item) {
          if (err) return this.respond(res, 500, err);
          if (!item) return this.respond(res, 404);
          res.json(item);
        }.bind(this));
      }, options));
      return this;
    },

    /**
     * Post (Create) a new item
     */
    post: function(options) {
      this.methods.push('post');
      app.post.apply(app, this.register(this.route, function(req, res, next) {
        this.model.create(req.body, function(err, item) {
          if (err) return this.respond(res, 400, err);
          res.status(201).json(item);
        }.bind(this));
      }, options));
      return this;
    },

    /**
     * Put (Update) a resource.
     */
    put: function(options) {
      this.methods.push('put');
      app.put.apply(app, this.register(this.route + '/:' + this.name + 'Id', function(req, res, next) {
        var query = req.modelQuery || this.model;
        query.findOne({"_id": req.params[this.name + 'Id']}, function(err, item) {
          if (err) return this.respond(res, 500, err);
          if (!item) return this.respond(res, 404);
          item.set(req.body);
          item.save(function (err, item) {
            if (err) return this.respond(res, 400, err);
            res.json(item);
          }.bind(this));
        }.bind(this));
      }, options));
      return this;
    },

    /**
     * Delete a resource.
     */
    delete: function(options) {
      this.methods.push('delete');
      app.delete.apply(app, this.register(this.route + '/:' + this.name + 'Id', function(req, res, next) {
        var query = req.modelQuery || this.model;
        query.findOne({"_id": req.params[this.name + 'Id']}, function(err, item) {
          if (err) return this.respond(res, 500, err);
          if (!item) return this.respond(res, 404);
          item.remove(function (err, item) {
            if (err) return this.respond(res, 400, err);
            res.status(204).json();
          }.bind(this));
        }.bind(this));
      }, options));
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
