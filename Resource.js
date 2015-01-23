var _ = require('lodash');

module.exports = function(app, route, name, model) {
  name = name.toLowerCase();
  route += '/' + name;

  // Return the object that defines this resource.
  return {

    // Allow access to the model.
    model: model,

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
     * The index for a resource.
     *
     * @param options
     */
    index: function(options) {
      app.get.apply(app, this.register(route, function(req, res, next) {
        var query = req.modelQuery || this.model;
        query.find(function(err, items) {
          if (err) return this.respond(res, 500, err);
          res.json(items);
        }.bind(this));
      }, options));
      return this;
    },

    /**
     * Register the GET method for this resource.
     */
    get: function(options) {
      app.get.apply(app, this.register(route + '/:' + name + 'Id', function(req, res, next) {
        var query = req.modelQuery || this.model;
        query.findOne({"_id": req.params[name + 'Id']}, function(err, item) {
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
      app.post.apply(app, this.register(route, function(req, res, next) {
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
      app.put.apply(app, this.register(route + '/:' + name + 'Id', function(req, res, next) {
        var query = req.modelQuery || this.model;
        query.findOne({"_id": req.params[name + 'Id']}, function(err, item) {
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
      app.delete.apply(app, this.register(route + '/:' + name + 'Id', function(req, res, next) {
        var query = req.modelQuery || this.model;
        query.findOne({"_id": req.params[name + 'Id']}, function(err, item) {
          if (err) return this.respond(res, 500, err);
          if (!item) return this.respond(res, 404);
          item.remove(function (err, item) {
            if (err) return this.respond(res, 400, err);
            res.status(204).json();
          }.bind(this));
        }.bind(this));
      }, options));
      return this;
    }
  };
};
