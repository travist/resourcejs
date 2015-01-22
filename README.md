Resource.js - A simple Express library to reflect Mongoose models to a REST interface.
==============================================================

Resource.js is designed to be a minimalistic Express library that reflects a Mongoose
model to a RESTful interface. It does this through a very simple and extensible interface.

Provided the following code

```
var express = require('express');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var Resource = require('../Resource');

// Create the app.
var app = express();

// Use the body parser.
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// Create the schema.
var ResourceSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String
  }
});

// Create the model.
var ResourceModel = mongoose.model('Resource', ResourceSchema);

// Create the REST resource.
Resource(app, '', 'resource', ResourceModel).rest();
```

The following rest interface would then be exposed.

 * ***/resource*** - (GET) - List all resources.
 * ***/resource*** - (POST) - Create a new resource.
 * ***/resource/:id*** - (GET) - Get a specific resource.
 * ***/resource/:id*** - (PUT) - Updates an existing resource.
 * ***/resource/:id*** - (DELETE) - Deletes an existing resource.

Only exposing certain methods
-------------------
You can also expose only a certain amount of methods, by instead of using
the ***rest*** method, you can use the specific methods and then chain them
together like so.

```
// Do not expose DELETE.
Resource(app, '', 'resource', ResourceModel).get().put().post().index();
```

Adding Before and After handlers
-------------------
This library allows you to handle middleware either before or after the
request is made to the Mongoose query mechanism.  This allows you to
either alter the query being made or, provide authentication.

For example, if you wish to provide basic authentication to every endpoint,
you can use the ***before*** callback attached to the ***rest*** method like so.

```
npm install basic-auth-connect
```

```
var basicAuth = require('basic-auth-connect');

...
...

Resource(app, '', 'resource', ResourceModel).rest({
  before: basicAuth('username', 'password')
});
```

You can also target individual methods so if you wanted to protect POST, PUT, and DELETE
but not GET and INDEX you would do the following.

```
Resource(app, '', 'resource', ResourceModel).rest({
  beforePut: basicAuth('username', 'password'),
  beforePost: basicAuth('username', 'password'),
  beforeDelete: basicAuth('username', 'password')
});
```

You can also do this by specifying the handlers within the specific method calls like so.

```
Resource(app, '', 'resource', ResourceModel)
  .get()
  .put({
    before: basicAuth('username', 'password'),
    after: function(req, res, next) {
      console.log("PUT was just called!");
    }
  })
  .post({
  	before: basicAuth('username', 'password')
  });
```

Adding custom queries
---------------------------------
Using the method above, it is possible to provide some custom queries in your ***before*** middleware.
We can do this by adding a ***methodQuery*** to the ***req*** object during the middleware. This query
uses the Mongoose query mechanism that you can see here http://mongoosejs.com/docs/api.html#query_Query-where.

For example, if we wish to show an index that filters ages greater than 18, we would do the following.

```
Resource(app, '', 'user', UserModel).rest({
  before: function(req, res, next) {
    req.modelQuery = this.model.where('age').gt(18);
  }
});
```
